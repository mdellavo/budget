from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from sqlalchemy import func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .ai import ENRICH_BATCH_SIZE, enricher
from .database import AsyncSessionLocal
from .models import Tag, Transaction, transaction_tags
from .query import (
    AiSummaryCacheQueries,
    CardHolderQueries,
    CategoryQueries,
    CsvImportQueries,
    EnrichmentBatchQueries,
    MerchantQueries,
    TransactionQueries,
)

logger = logging.getLogger(__name__)


def _setup_worker_logging() -> None:
    """Configure logging for the RQ worker entry points.

    logging.basicConfig is a no-op if handlers are already attached to the
    root logger (which RQ does before importing job modules).  Calling it here
    — inside the sync entry points — ensures it runs after the module is
    imported and still sets up a StreamHandler when none is present.  Setting
    the 'budget' logger level explicitly guarantees INFO messages are emitted
    even when the root logger's effective level is WARNING.
    """
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
    )
    logging.getLogger("budget").setLevel(logging.INFO)


DATE_FORMATS = ["%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%d/%m/%Y", "%B %d, %Y"]


def parse_date(value: str) -> date:
    value = value.strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Unrecognised date format: {value!r}")


def parse_amount(value: str) -> Decimal:
    cleaned = value.strip().lstrip("$").replace(",", "").replace(" ", "")
    if cleaned.startswith("(") and cleaned.endswith(")"):
        cleaned = "-" + cleaned[1:-1]
    return Decimal(cleaned)


def _make_fingerprint(
    account_id: int,
    date_val: date,
    amount_val: Decimal,
    raw_desc: str | None,
) -> str:
    """Return a 16-char hex fingerprint for a transaction row.

    Stable across imports: re-importing an overlapping CSV silently skips
    already-present rows.  Identical rows within the same import collapse to
    one transaction; use the Duplicates page to review and exclude extras.
    """
    desc = (raw_desc or "").strip().lower()
    base = f"{account_id}:{date_val}:{amount_val}:{desc}"
    return hashlib.sha256(base.encode()).hexdigest()[:16]


async def _run_enrichment(
    enrich_input: list[dict],
    rows: list[dict],
    date_col: str,
    amount_col: str,
    desc_col: str | None,
    account_id: int,
    csv_import_id: int,
    account_type: str | None = None,
    user_id: int | None = None,
) -> None:
    logger.info(
        "Background enrichment starting for csv_import_id=%d (%d rows)",
        csv_import_id,
        len(rows),
    )

    batches = [
        enrich_input[i : i + ENRICH_BATCH_SIZE]
        for i in range(0, len(enrich_input), ENRICH_BATCH_SIZE)
    ]
    sem = asyncio.Semaphore(3)

    # Pre-count rows whose fingerprints already exist in the DB (duplicates)
    fp_list: list[str] = []
    for row in rows:
        try:
            d = parse_date(row[date_col])
            a = parse_amount(row[amount_col])
            if account_type == "Credit Card":
                a = -a
            raw = row[desc_col].strip() if desc_col else None
            fp_list.append(_make_fingerprint(account_id, d, a, raw))
        except (ValueError, InvalidOperation):
            pass
    if fp_list:
        async with AsyncSessionLocal() as db:
            dup_count = (
                await db.scalar(
                    select(func.count())
                    .select_from(Transaction)
                    .where(
                        Transaction.user_id == user_id,
                        Transaction.fingerprint.in_(fp_list),
                    )
                )
                or 0
            )
            await CsvImportQueries(db).set_skipped_duplicates(csv_import_id, dup_count)
            await db.commit()

    async def fetch_batch(batch, batch_num):
        async with AsyncSessionLocal() as db:
            eb = await EnrichmentBatchQueries(db).create(
                csv_import_id, batch_num, len(batch)
            )
            batch_id = eb.id
            await db.commit()

        for attempt in range(1, 4):  # attempts 1, 2, 3
            async with sem:
                try:
                    results, input_tok, output_tok = await asyncio.to_thread(
                        enricher._enrich_batch, batch, batch_num
                    )
                    async with AsyncSessionLocal() as db:
                        await EnrichmentBatchQueries(db).complete(
                            batch_id, input_tok, output_tok
                        )
                        await db.commit()
                    return results
                except Exception:
                    if attempt == 3:
                        async with AsyncSessionLocal() as db:
                            await EnrichmentBatchQueries(db).fail(batch_id)
                            await db.commit()
                        raise
                    logger.warning(
                        "Batch %d attempt %d/%d failed for csv_import_id=%d, retrying…",
                        batch_num,
                        attempt,
                        3,
                        csv_import_id,
                        exc_info=True,
                    )
            await asyncio.sleep(2**attempt)  # 2s, 4s between retries (outside sem)

    tasks = [
        asyncio.create_task(fetch_batch(batch, i)) for i, batch in enumerate(batches)
    ]

    async with AsyncSessionLocal() as db:
        mq = MerchantQueries(db, user_id=user_id)
        cq = CategoryQueries(db, user_id=user_id)
        chq = CardHolderQueries(db, user_id=user_id)
        csq = CsvImportQueries(db, user_id=user_id)
        merchant_cache: dict[str, tuple[int, bool]] = {}  # name → (id, has_location)
        category_cache: dict[str, int] = {}
        subcategory_cache: dict[tuple, int] = {}
        cardholder_cache: dict[str, int] = {}

        for coro in asyncio.as_completed(tasks):
            try:
                batch_results = await coro
            except Exception:
                logger.exception("A batch failed for csv_import_id=%d", csv_import_id)
                continue

            attempted = len(batch_results)

            for r in batch_results:
                i = r["index"]
                row = rows[i]

                try:
                    date_val = parse_date(row[date_col])
                    amount_val = parse_amount(row[amount_col])
                    if account_type == "Credit Card":
                        amount_val = -amount_val
                except (ValueError, InvalidOperation) as e:
                    logger.warning(
                        "csv_import_id=%d row %d parse error: %s", csv_import_id, i, e
                    )
                    continue

                mname = r.get("merchant_name")
                mlocation = r.get("merchant_location")
                mwebsite = r.get("merchant_website")
                cname = r.get("category")
                need_want = r.get("need_want")
                scname = r.get("subcategory")
                cn = r.get("card_number")

                merchant_id = None
                if mname:
                    merchant_id = await mq.find_or_create_for_enrichment(
                        mname, mlocation, merchant_cache, mwebsite
                    )

                category_id = None
                if cname:
                    category_id = await cq.find_or_create_for_enrichment(
                        cname, category_cache
                    )

                subcategory_id = None
                if cname and scname:
                    assert category_id is not None
                    subcategory_id = await cq.find_or_create_subcategory_for_enrichment(
                        category_id, scname, subcategory_cache, need_want
                    )

                cardholder_id = None
                if cn:
                    cardholder_id = await chq.find_or_create_for_enrichment(
                        cn, cardholder_cache
                    )

                raw_description = row[desc_col].strip() if desc_col else None
                description = r.get("description") or raw_description or ""
                is_recurring = bool(r.get("is_recurring", False))
                is_refund = bool(r.get("is_refund", False))
                is_international = bool(r.get("is_international", False))
                payment_channel = r.get("payment_channel")
                tag_names = [
                    t.strip().lower()
                    for t in (r.get("suggested_tags") or [])
                    if t.strip()
                ]
                fp = _make_fingerprint(
                    account_id, date_val, amount_val, raw_description
                )
                stmt = sqlite_insert(Transaction).values(
                    account_id=account_id,
                    csv_import_id=csv_import_id,
                    date=date_val,
                    description=description,
                    raw_description=raw_description,
                    amount=amount_val,
                    merchant_id=merchant_id,
                    subcategory_id=subcategory_id,
                    cardholder_id=cardholder_id,
                    is_recurring=is_recurring,
                    is_refund=is_refund,
                    is_international=is_international,
                    payment_channel=payment_channel,
                    fingerprint=fp,
                    user_id=user_id,
                )
                stmt = stmt.on_conflict_do_update(
                    index_elements=["user_id", "fingerprint"],
                    set_={
                        "description": stmt.excluded.description,
                        "merchant_id": stmt.excluded.merchant_id,
                        "subcategory_id": stmt.excluded.subcategory_id,
                        "cardholder_id": stmt.excluded.cardholder_id,
                        "is_recurring": stmt.excluded.is_recurring,
                        "is_refund": stmt.excluded.is_refund,
                        "is_international": stmt.excluded.is_international,
                        "payment_channel": stmt.excluded.payment_channel,
                        "csv_import_id": stmt.excluded.csv_import_id,
                    },
                ).returning(Transaction.id)
                result = await db.execute(stmt)
                tx_id = result.scalar_one()
                for tag_name in tag_names:
                    tag = await db.scalar(
                        select(Tag).where(Tag.user_id == user_id, Tag.name == tag_name)
                    )
                    if not tag:
                        tag = Tag(user_id=user_id, name=tag_name)
                        db.add(tag)
                        await db.flush()
                    await db.execute(
                        sqlite_insert(transaction_tags)
                        .values(transaction_id=tx_id, tag_id=tag.id)
                        .on_conflict_do_nothing()
                    )

            await db.commit()

            await csq.increment_enriched(csv_import_id, attempted)
            await db.commit()

            # Check for abort between batches
            async with AsyncSessionLocal() as abort_check:
                imp_check = await CsvImportQueries(abort_check).get_by_id(csv_import_id)
                if imp_check and imp_check.status == "aborted":
                    for t in tasks:
                        if not t.done():
                            t.cancel()
                    logger.info(
                        "Background enrichment aborted for csv_import_id=%d",
                        csv_import_id,
                    )
                    return  # Do NOT mark complete

    if user_id is not None:
        async with AsyncSessionLocal() as db:
            tq = TransactionQueries(db, user_id=user_id)
            await tq.match_transfers()
            await db.commit()

    async with AsyncSessionLocal() as db:
        csq = CsvImportQueries(db)
        await csq.mark_complete(csv_import_id)
        await db.commit()

    if user_id is not None:
        async with AsyncSessionLocal() as db:
            await AiSummaryCacheQueries(db, user_id=user_id).invalidate_all()
            await db.commit()

    logger.info("Background enrichment complete for csv_import_id=%d", csv_import_id)


async def _run_reenrichment_for_import(
    csv_import_id: int, user_id: int | None = None
) -> None:
    logger.info("Re-enrichment starting for csv_import_id=%d", csv_import_id)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(
                Transaction.id,
                Transaction.raw_description,
                Transaction.amount,
                Transaction.date,
            ).where(
                Transaction.csv_import_id == csv_import_id,
                Transaction.raw_description.isnot(None),
            )
        )
        rows = result.all()

    if not rows:
        async with AsyncSessionLocal() as db:
            await CsvImportQueries(db).mark_complete(csv_import_id)
            await db.commit()
        return

    enrich_input = [
        {
            "index": i,
            "description": r.raw_description,
            "amount": str(r.amount),
            "date": str(r.date),
        }
        for i, r in enumerate(rows)
    ]
    tx_ids = [r.id for r in rows]

    batches = [
        enrich_input[i : i + ENRICH_BATCH_SIZE]
        for i in range(0, len(enrich_input), ENRICH_BATCH_SIZE)
    ]
    sem = asyncio.Semaphore(3)

    async def fetch_batch(batch, batch_num):
        async with AsyncSessionLocal() as db:
            eb = await EnrichmentBatchQueries(db).create(
                csv_import_id, batch_num, len(batch)
            )
            batch_id = eb.id
            await db.commit()

        for attempt in range(1, 4):
            async with sem:
                try:
                    results, input_tok, output_tok = await asyncio.to_thread(
                        enricher._enrich_batch, batch, batch_num
                    )
                    async with AsyncSessionLocal() as db:
                        await EnrichmentBatchQueries(db).complete(
                            batch_id, input_tok, output_tok
                        )
                        await db.commit()
                    return results
                except Exception:
                    if attempt == 3:
                        async with AsyncSessionLocal() as db:
                            await EnrichmentBatchQueries(db).fail(batch_id)
                            await db.commit()
                        raise
                    logger.warning(
                        "Re-enrich batch %d attempt %d failed for csv_import_id=%d",
                        batch_num,
                        attempt,
                        csv_import_id,
                        exc_info=True,
                    )
            await asyncio.sleep(2**attempt)

    tasks = [
        asyncio.create_task(fetch_batch(batch, i)) for i, batch in enumerate(batches)
    ]

    async with AsyncSessionLocal() as db:
        mq = MerchantQueries(db, user_id=user_id)
        cq = CategoryQueries(db, user_id=user_id)
        chq = CardHolderQueries(db, user_id=user_id)
        csq = CsvImportQueries(db, user_id=user_id)
        merchant_cache: dict[str, tuple[int, bool]] = {}
        category_cache: dict[str, int] = {}
        subcategory_cache: dict[tuple, int] = {}
        cardholder_cache: dict[str, int] = {}

        for coro in asyncio.as_completed(tasks):
            try:
                batch_results = await coro
            except Exception:
                logger.exception(
                    "Re-enrich batch failed for csv_import_id=%d", csv_import_id
                )
                continue

            for r in batch_results:
                tx = await db.get(Transaction, tx_ids[r["index"]])
                if tx is None:
                    continue

                mname = r.get("merchant_name")
                if mname:
                    tx.merchant_id = await mq.find_or_create_for_enrichment(
                        mname,
                        r.get("merchant_location"),
                        merchant_cache,
                        r.get("merchant_website"),
                    )
                else:
                    tx.merchant_id = None

                cname, scname = r.get("category"), r.get("subcategory")
                if cname and scname:
                    cid = await cq.find_or_create_for_enrichment(cname, category_cache)
                    tx.subcategory_id = (
                        await cq.find_or_create_subcategory_for_enrichment(
                            cid, scname, subcategory_cache, r.get("need_want")
                        )
                    )
                else:
                    tx.subcategory_id = None

                cn = r.get("card_number")
                if cn:
                    tx.cardholder_id = await chq.find_or_create_for_enrichment(
                        cn, cardholder_cache
                    )
                else:
                    tx.cardholder_id = None

                if r.get("description"):
                    tx.description = r["description"]
                tx.is_recurring = bool(r.get("is_recurring", False))

            await db.commit()
            await csq.increment_enriched(csv_import_id, len(batch_results))
            await db.commit()

            # Check for abort between batches
            async with AsyncSessionLocal() as abort_check:
                imp_check = await CsvImportQueries(abort_check).get_by_id(csv_import_id)
                if imp_check and imp_check.status == "aborted":
                    for t in tasks:
                        if not t.done():
                            t.cancel()
                    logger.info(
                        "Re-enrichment aborted for csv_import_id=%d", csv_import_id
                    )
                    return  # Do NOT mark complete

    async with AsyncSessionLocal() as db:
        await CsvImportQueries(db).mark_complete(csv_import_id)
        await db.commit()

    logger.info("Re-enrichment complete for csv_import_id=%d", csv_import_id)


def run_enrichment_job(
    enrich_input: list[dict],
    rows: list[dict],
    date_col: str,
    amount_col: str,
    desc_col: str | None,
    account_id: int,
    csv_import_id: int,
    account_type: str | None = None,
    user_id: int | None = None,
) -> None:
    _setup_worker_logging()
    try:
        asyncio.run(
            _run_enrichment(
                enrich_input=enrich_input,
                rows=rows,
                date_col=date_col,
                amount_col=amount_col,
                desc_col=desc_col,
                account_id=account_id,
                csv_import_id=csv_import_id,
                account_type=account_type,
                user_id=user_id,
            )
        )
    except Exception:
        logger.exception(
            "run_enrichment_job failed for csv_import_id=%d", csv_import_id
        )
        raise


def run_reenrichment_job(csv_import_id: int, user_id: int | None = None) -> None:
    _setup_worker_logging()
    try:
        asyncio.run(_run_reenrichment_for_import(csv_import_id, user_id))
    except Exception:
        logger.exception(
            "run_reenrichment_job failed for csv_import_id=%d", csv_import_id
        )
        raise
