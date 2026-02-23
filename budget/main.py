import asyncio
import csv
import io
import logging
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from statistics import median as _median
from typing import Literal

from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from . import models  # noqa: F401 — ensures models are registered with Base
from .ai import (
    ENRICH_BATCH_SIZE,
    detector,
    enricher,
    merchant_duplicate_finder,
    query_parser,
)
from .database import AsyncSessionLocal, Base, engine, get_db
from .models import Merchant, Transaction
from .query import (
    AccountQueries,
    AnalyticsQueries,
    CardHolderQueries,
    CategoryQueries,
    CsvImportQueries,
    MerchantQueries,
    TransactionQueries,
)

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        try:
            await conn.execute(
                text(
                    "ALTER TABLE csv_imports ADD COLUMN enriched_rows INTEGER NOT NULL DEFAULT 0"
                )
            )
        except Exception:
            pass  # column already exists on fresh or previously-migrated DB
        try:
            await conn.execute(text("ALTER TABLE merchants ADD COLUMN location TEXT"))
        except Exception:
            pass  # column already exists
        try:
            await conn.execute(
                text(
                    "ALTER TABLE transactions ADD COLUMN is_recurring BOOLEAN NOT NULL DEFAULT 0"
                )
            )
        except Exception:
            pass  # column already exists
        try:
            await conn.execute(
                text(
                    "ALTER TABLE csv_imports ADD COLUMN status TEXT NOT NULL DEFAULT 'complete'"
                )
            )
        except Exception:
            pass  # column already exists
        try:
            await conn.execute(
                text("ALTER TABLE transactions ADD COLUMN raw_description TEXT")
            )
        except Exception:
            pass  # column already exists
        try:
            await conn.execute(
                text(
                    "ALTER TABLE transactions ADD COLUMN cardholder_id INTEGER REFERENCES cardholders(id)"
                )
            )
        except Exception:
            pass  # column already exists
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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


async def _run_enrichment(
    enrich_input: list[dict],
    rows: list[dict],
    date_col: str,
    amount_col: str,
    desc_col: str | None,
    account_id: int,
    csv_import_id: int,
    account_type: str | None = None,
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

    async def fetch_batch(batch, batch_num):
        for attempt in range(1, 4):  # attempts 1, 2, 3
            async with sem:
                try:
                    return await asyncio.to_thread(
                        enricher._enrich_batch, batch, batch_num
                    )
                except Exception:
                    if attempt == 3:
                        raise
                    logger.warning(
                        "Batch %d attempt %d/%d failed for csv_import_id=%d, retrying…",
                        batch_num,
                        attempt,
                        3,
                        csv_import_id,
                    )
            await asyncio.sleep(2**attempt)  # 2s, 4s between retries (outside sem)

    tasks = [
        asyncio.create_task(fetch_batch(batch, i)) for i, batch in enumerate(batches)
    ]

    async with AsyncSessionLocal() as db:
        mq = MerchantQueries(db)
        cq = CategoryQueries(db)
        chq = CardHolderQueries(db)
        csq = CsvImportQueries(db)
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
                cname = r.get("category")
                scname = r.get("subcategory")
                cn = r.get("card_number")

                merchant_id = None
                if mname:
                    merchant_id = await mq.find_or_create_for_enrichment(
                        mname, mlocation, merchant_cache
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
                        category_id, scname, subcategory_cache
                    )

                cardholder_id = None
                if cn:
                    cardholder_id = await chq.find_or_create_for_enrichment(
                        cn, cardholder_cache
                    )

                raw_description = row[desc_col].strip() if desc_col else None
                description = r.get("description") or raw_description or ""
                is_recurring = bool(r.get("is_recurring", False))
                db.add(
                    Transaction(
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
                    )
                )

            await db.commit()

            await csq.increment_enriched(csv_import_id, attempted)
            await db.commit()

    async with AsyncSessionLocal() as db:
        csq = CsvImportQueries(db)
        await csq.mark_complete(csv_import_id)
        await db.commit()

    logger.info("Background enrichment complete for csv_import_id=%d", csv_import_id)


FREQUENCY_RANGES = [
    ("weekly", 5, 10),
    ("biweekly", 11, 18),
    ("monthly", 22, 45),
    ("quarterly", 60, 120),
    ("annual", 300, 400),
]
MONTHLY_FACTORS = {
    "weekly": 52 / 12,
    "biweekly": 26 / 12,
    "monthly": 1,
    "quarterly": 1 / 3,
    "annual": 1 / 12,
}


def _classify_gap(median_days: float) -> str | None:
    for name, lo, hi in FREQUENCY_RANGES:
        if lo <= median_days <= hi:
            return name
    return None


@app.get("/recurring")
async def get_recurring(db: AsyncSession = Depends(get_db)):
    rows = await AnalyticsQueries(db).get_recurring_transactions()

    groups: dict[object, list] = defaultdict(list)
    for r in rows:
        key = (
            r.merchant_id
            if r.merchant_id is not None
            else f"desc:{r.description.strip().lower()}"
        )
        groups[key].append(r)

    results = []
    for txns in groups.values():
        if len(txns) < 2:
            continue
        dates = sorted(t.date for t in txns)
        gaps = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
        median_gap = _median(gaps)
        frequency = _classify_gap(median_gap)
        if frequency is None:
            continue

        amounts = [abs(float(t.amount)) for t in txns]
        median_amount = _median(amounts)
        monthly_cost = median_amount * MONTHLY_FACTORS[frequency]
        next_estimated = dates[-1] + timedelta(days=round(median_gap))

        rep = txns[0]
        results.append(
            {
                "merchant": rep.merchant_name or rep.description,
                "merchant_id": rep.merchant_id,
                "category": rep.category_name,
                "amount": str(round(median_amount, 2)),
                "frequency": frequency,
                "occurrences": len(txns),
                "last_charge": dates[-1].isoformat(),
                "next_estimated": next_estimated.isoformat(),
                "monthly_cost": str(round(monthly_cost, 2)),
            }
        )

    results.sort(key=lambda x: float(x["monthly_cost"]), reverse=True)
    return {"items": results}


@app.get("/monthly")
async def list_months(db: AsyncSession = Depends(get_db)):
    months = await AnalyticsQueries(db).list_months()
    return {"months": months}


@app.get("/monthly/{month}")
async def get_monthly_report(month: str, db: AsyncSession = Depends(get_db)):
    aq = AnalyticsQueries(db)
    stats = await aq.get_month_stats(month)
    transaction_count = stats["transaction_count"]
    income = stats["income"]
    expenses = stats["expenses"]
    net = income + expenses  # expenses is negative
    savings_rate = float(net / income * 100) if income > 0 else None

    # Category + subcategory breakdown for expenses
    rows = await aq.get_category_breakdown(month)

    # Build category → subcategory tree
    cat_totals: dict[str, Decimal] = defaultdict(Decimal)
    cat_subs: dict[str, list] = defaultdict(list)
    for r in rows:
        cat_totals[r.category] += r.total
        cat_subs[r.category].append(
            {"subcategory": r.subcategory, "total": str(r.total)}
        )

    category_breakdown = [
        {
            "category": cat,
            "total": str(cat_totals[cat]),
            "subcategories": sorted(cat_subs[cat], key=lambda x: float(x["total"])),
        }
        for cat in sorted(
            cat_totals, key=lambda c: float(cat_totals[c])
        )  # most negative first
    ]

    return {
        "month": month,
        "summary": {
            "transaction_count": transaction_count,
            "income": str(income),
            "expenses": str(expenses),
            "net": str(net),
            "savings_rate": savings_rate,
        },
        "category_breakdown": category_breakdown,
    }


@app.get("/overview")
async def get_overview(db: AsyncSession = Depends(get_db)):
    aq = AnalyticsQueries(db)
    summary = await aq.get_overview_summary()
    transaction_count = summary["transaction_count"]
    net = summary["net"]
    income = summary["income"]
    expenses = summary["expenses"]
    savings_rate = float(net / income * 100) if income > 0 else None

    # --- sankey: income by merchant ---
    income_rows = await aq.get_income_by_merchant()

    # top 8 income sources; collapse rest into "Other Income"
    TOP_INCOME = 8
    income_sources = [
        {"name": r.name, "amount": str(r.total)} for r in income_rows[:TOP_INCOME]
    ]
    if len(income_rows) > TOP_INCOME:
        other_income = sum(r.total for r in income_rows[TOP_INCOME:])
        income_sources.append({"name": "Other Income", "amount": str(other_income)})

    # --- sankey: expenses by category ---
    expense_rows = await aq.get_expenses_by_category()

    # top 14 expense categories; collapse rest into "Other Expenses"
    TOP_EXPENSES = 14
    expense_categories = [
        {"name": r.name, "amount": str(r.total)} for r in expense_rows[:TOP_EXPENSES]
    ]
    if len(expense_rows) > TOP_EXPENSES:
        other_exp = sum(r.total for r in expense_rows[TOP_EXPENSES:])
        expense_categories.append({"name": "Other Expenses", "amount": str(other_exp)})

    # --- donut: all expense categories (no cap) ---
    expense_breakdown = [
        {"name": r.name, "amount": str(r.total)}
        for r in expense_rows
        if float(r.total) < 0
    ]

    return {
        "transaction_count": transaction_count,
        "income": str(income),
        "expenses": str(expenses),
        "net": str(net),
        "savings_rate": savings_rate,
        "expense_breakdown": expense_breakdown,
        "sankey": {
            "income_sources": income_sources,
            "expense_categories": expense_categories,
        },
    }


@app.get("/merchants")
async def list_merchants(
    name: str | None = Query(
        None, description="Case-insensitive substring match on merchant name"
    ),
    location: str | None = Query(
        None, description="Case-insensitive substring match on merchant location"
    ),
    after: int | None = Query(None, description="Cursor: last seen merchant ID"),
    limit: int = Query(50, ge=1, le=500),
    sort_by: Literal["name", "transaction_count", "total_amount"] = Query("name"),
    sort_dir: Literal["asc", "desc"] = Query("asc"),
    db: AsyncSession = Depends(get_db),
):
    items, has_more, next_cursor = await MerchantQueries(db).paginate(
        name=name,
        location=location,
        sort_by=sort_by,
        sort_dir=sort_dir,
        limit=limit,
        after_id=after,
    )
    return {
        "items": [
            {
                "id": r.id,
                "name": r.name,
                "location": r.location,
                "transaction_count": r.transaction_count,
                "total_amount": str(r.total_amount),
            }
            for r in items
        ],
        "has_more": has_more,
        "next_cursor": next_cursor,
    }


def _merchant_row(merchant: Merchant, transaction_count: int, total_amount) -> dict:
    return {
        "id": merchant.id,
        "name": merchant.name,
        "location": merchant.location,
        "transaction_count": transaction_count,
        "total_amount": str(total_amount),
    }


@app.get("/merchants/{merchant_id}")
async def get_merchant(merchant_id: int, db: AsyncSession = Depends(get_db)):
    mq = MerchantQueries(db)
    merchant = await mq.get_by_id(merchant_id)
    if merchant is None:
        raise HTTPException(status_code=404, detail="Merchant not found")
    transaction_count, total_amount = await mq.get_stats(merchant_id)
    return _merchant_row(merchant, transaction_count, total_amount)


class MerchantUpdate(BaseModel):
    name: str
    location: str | None


@app.patch("/merchants/{merchant_id}")
async def update_merchant(
    merchant_id: int, body: MerchantUpdate, db: AsyncSession = Depends(get_db)
):
    mq = MerchantQueries(db)
    merchant = await mq.get_by_id(merchant_id)
    if merchant is None:
        raise HTTPException(status_code=404, detail="Merchant not found")
    await mq.update(merchant, body.name, body.location)
    await db.commit()
    await db.refresh(merchant)
    transaction_count, total_amount = await mq.get_stats(merchant_id)
    return _merchant_row(merchant, transaction_count, total_amount)


@app.get("/categories")
async def list_categories(
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    category: str | None = Query(None, description="Case-insensitive substring match"),
    subcategory: str | None = Query(
        None, description="Case-insensitive substring match"
    ),
    sort_by: Literal[
        "category", "subcategory", "transaction_count", "total_amount"
    ] = Query("category"),
    sort_dir: Literal["asc", "desc"] = Query("asc"),
    db: AsyncSession = Depends(get_db),
):
    rows = await CategoryQueries(db).list_with_stats(
        date_from=date_from,
        date_to=date_to,
        category=category,
        subcategory=subcategory,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )
    return {
        "items": [
            {
                "category": r.category,
                "subcategory": r.subcategory,
                "transaction_count": r.transaction_count,
                "total_amount": str(r.total_amount),
            }
            for r in rows
        ]
    }


@app.get("/accounts")
async def list_accounts(
    name: str | None = Query(
        None, description="Case-insensitive substring match on account name"
    ),
    institution: str | None = Query(
        None, description="Case-insensitive substring match on institution"
    ),
    account_type: str | None = Query(
        None, description="Case-insensitive substring match on account type"
    ),
    after: int | None = Query(None, description="Cursor: last seen account ID"),
    limit: int = Query(50, ge=1, le=500),
    sort_by: Literal[
        "name",
        "institution",
        "account_type",
        "created_at",
        "transaction_count",
        "total_amount",
    ] = Query("name"),
    sort_dir: Literal["asc", "desc"] = Query("asc"),
    db: AsyncSession = Depends(get_db),
):
    items, has_more, next_cursor = await AccountQueries(db).list(
        name=name,
        institution=institution,
        account_type=account_type,
        sort_by=sort_by,
        sort_dir=sort_dir,
        limit=limit,
        after_id=after,
    )
    return {
        "items": [
            {
                "id": r.id,
                "name": r.name,
                "institution": r.institution,
                "account_type": r.account_type,
                "created_at": r.created_at.isoformat(),
                "transaction_count": r.transaction_count,
                "total_amount": str(r.total_amount),
            }
            for r in items
        ],
        "has_more": has_more,
        "next_cursor": next_cursor,
    }


@app.get("/imports")
async def list_imports(
    filename: str | None = Query(
        None, description="Case-insensitive substring match on filename"
    ),
    account: str | None = Query(
        None, description="Case-insensitive substring match on account name"
    ),
    after: int | None = Query(None, description="Cursor: last seen import ID"),
    limit: int = Query(50, ge=1, le=500),
    sort_by: Literal[
        "filename", "account", "imported_at", "row_count", "transaction_count"
    ] = Query("imported_at"),
    sort_dir: Literal["asc", "desc"] = Query("desc"),
    db: AsyncSession = Depends(get_db),
):
    items, has_more, next_cursor = await CsvImportQueries(db).list(
        filename=filename,
        account=account,
        sort_by=sort_by,
        sort_dir=sort_dir,
        limit=limit,
        after_id=after,
    )
    return {
        "items": [
            {
                "id": r.id,
                "filename": r.filename,
                "account": r.account,
                "imported_at": r.imported_at.isoformat() + "Z",
                "row_count": r.row_count,
                "enriched_rows": r.enriched_rows,
                "status": r.status,
                "transaction_count": r.transaction_count,
            }
            for r in items
        ],
        "has_more": has_more,
        "next_cursor": next_cursor,
    }


@app.get("/imports/{import_id}/progress")
async def get_import_progress(import_id: int, db: AsyncSession = Depends(get_db)):
    csv_import = await CsvImportQueries(db).get_by_id(import_id)
    if csv_import is None:
        raise HTTPException(status_code=404, detail="Import not found")
    return {
        "csv_import_id": csv_import.id,
        "row_count": csv_import.row_count,
        "enriched_rows": csv_import.enriched_rows,
        "complete": csv_import.enriched_rows >= csv_import.row_count,
    }


async def _run_reenrichment_for_import(csv_import_id: int) -> None:
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
        for attempt in range(1, 4):
            async with sem:
                try:
                    return await asyncio.to_thread(
                        enricher._enrich_batch, batch, batch_num
                    )
                except Exception:
                    if attempt == 3:
                        raise
                    logger.warning(
                        "Re-enrich batch %d attempt %d failed for csv_import_id=%d",
                        batch_num,
                        attempt,
                        csv_import_id,
                    )
            await asyncio.sleep(2**attempt)

    tasks = [
        asyncio.create_task(fetch_batch(batch, i)) for i, batch in enumerate(batches)
    ]

    async with AsyncSessionLocal() as db:
        mq = MerchantQueries(db)
        cq = CategoryQueries(db)
        chq = CardHolderQueries(db)
        csq = CsvImportQueries(db)
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
                        mname, r.get("merchant_location"), merchant_cache
                    )
                else:
                    tx.merchant_id = None

                cname, scname = r.get("category"), r.get("subcategory")
                if cname and scname:
                    cid = await cq.find_or_create_for_enrichment(cname, category_cache)
                    tx.subcategory_id = (
                        await cq.find_or_create_subcategory_for_enrichment(
                            cid, scname, subcategory_cache
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

    async with AsyncSessionLocal() as db:
        await CsvImportQueries(db).mark_complete(csv_import_id)
        await db.commit()

    logger.info("Re-enrichment complete for csv_import_id=%d", csv_import_id)


@app.post("/imports/{import_id}/re-enrich")
async def re_enrich_import(
    import_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    csq = CsvImportQueries(db)
    csv_import = await csq.get_by_id(import_id)
    if csv_import is None:
        raise HTTPException(status_code=404, detail="Import not found")
    if csv_import.status == "in-progress":
        raise HTTPException(status_code=409, detail="Import is already being enriched")
    await csq.reset_for_reenrichment(import_id)
    await db.commit()
    background_tasks.add_task(_run_reenrichment_for_import, import_id)
    return {"status": "processing", "csv_import_id": import_id}


@app.post("/import-csv")
async def import_csv(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    account_name: str = Form(...),
    account_type: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a CSV")

    contents = await file.read()
    decoded = contents.decode("utf-8")
    reader = csv.DictReader(io.StringIO(decoded))
    rows = list(reader)

    if reader.fieldnames is None:
        raise HTTPException(status_code=422, detail="CSV has no headers")
    fieldnames = list(reader.fieldnames)
    column_mapping = detector.detect(fieldnames, rows)

    date_idx = column_mapping["date"]
    amount_idx = column_mapping["amount"]
    if date_idx is None or amount_idx is None:
        raise HTTPException(
            status_code=422, detail="Could not detect date or amount columns"
        )

    # Upsert Account by name
    aq = AccountQueries(db)
    account = await aq.find_or_create(account_name)

    if account_type is not None:
        account.account_type = account_type

    # Re-import check: find existing CsvImport by filename
    csq = CsvImportQueries(db)
    existing = await csq.find_by_filename(file.filename)
    csv_import = await csq.upsert(
        account.id, file.filename, len(rows), column_mapping, existing
    )

    # Resolve column indices to header names
    date_col = fieldnames[date_idx]
    amount_col = fieldnames[amount_idx]
    desc_idx = column_mapping["description"]
    desc_col = fieldnames[desc_idx] if desc_idx is not None else None

    # Build enrichment input
    enrich_input = [
        {
            "index": i,
            "description": row[desc_col].strip() if desc_col else "",
            "amount": row[amount_col],
            "date": row[date_col],
        }
        for i, row in enumerate(rows)
    ]

    await db.commit()

    background_tasks.add_task(
        _run_enrichment,
        enrich_input,
        rows,
        date_col,
        amount_col,
        desc_col,
        account.id,
        csv_import.id,
        account_type,
    )

    return {
        "csv_import_id": csv_import.id,
        "filename": file.filename,
        "rows_imported": len(rows),
        "columns": fieldnames,
        "column_mapping": column_mapping,
        "status": "processing",
    }


@app.get("/transactions")
async def list_transactions(
    date_from: date | None = Query(
        None, description="Earliest date (YYYY-MM-DD), inclusive"
    ),
    date_to: date | None = Query(
        None, description="Latest date (YYYY-MM-DD), inclusive"
    ),
    merchant: str | None = Query(
        None, description="Case-insensitive substring match on merchant name"
    ),
    description: str | None = Query(
        None, description="Case-insensitive substring match on transaction description"
    ),
    amount_min: Decimal | None = Query(None, description="Minimum amount, inclusive"),
    amount_max: Decimal | None = Query(None, description="Maximum amount, inclusive"),
    category: str | None = Query(
        None, description="Case-insensitive match on category name"
    ),
    subcategory: str | None = Query(
        None, description="Case-insensitive match on subcategory name"
    ),
    account: str | None = Query(
        None, description="Case-insensitive substring match on account name"
    ),
    import_id: int | None = Query(
        None, description="Filter to transactions from a specific CSV import"
    ),
    is_recurring: bool | None = Query(
        None, description="Filter by recurring flag (true/false)"
    ),
    uncategorized: bool | None = Query(
        None, description="true = only transactions with no category/subcategory"
    ),
    cardholder: str | None = Query(
        None,
        description="Case-insensitive substring match on card number or cardholder name",
    ),
    after: int | None = Query(
        None,
        description="Cursor: last seen transaction ID (from previous response's next_cursor)",
    ),
    limit: int = Query(50, ge=1, le=500, description="Rows per page"),
    sort_by: Literal[
        "date", "amount", "description", "merchant", "category", "account"
    ] = Query("date"),
    sort_dir: Literal["asc", "desc"] = Query("desc"),
    db: AsyncSession = Depends(get_db),
):
    txq = TransactionQueries(db)
    conditions = txq.build_conditions(
        date_from=date_from,
        date_to=date_to,
        description=description,
        amount_min=amount_min,
        amount_max=amount_max,
        merchant=merchant,
        category=category,
        subcategory=subcategory,
        account=account,
        import_id=import_id,
        is_recurring=is_recurring,
        uncategorized=uncategorized,
        cardholder=cardholder,
    )
    total_count = await txq.count(conditions)
    items, has_more, next_cursor = await txq.list(
        conditions,
        sort_by=sort_by,
        sort_dir=sort_dir,
        limit=limit,
        after_id=after,
    )
    return {
        "items": [
            {
                "id": tx.id,
                "date": tx.date.isoformat(),
                "description": tx.description,
                "amount": str(tx.amount),
                "account_id": tx.account_id,
                "account": tx.account.name,
                "merchant": tx.merchant.name if tx.merchant else None,
                "category": tx.subcategory.category.name if tx.subcategory else None,
                "subcategory": tx.subcategory.name if tx.subcategory else None,
                "notes": tx.notes,
                "is_recurring": tx.is_recurring,
                "raw_description": tx.raw_description,
                "cardholder_name": tx.cardholder.name if tx.cardholder else None,
                "card_number": tx.cardholder.card_number if tx.cardholder else None,
            }
            for tx in items
        ],
        "has_more": has_more,
        "next_cursor": next_cursor,
        "total_count": total_count,
    }


# ---------------------------------------------------------------------------
# PATCH /transactions/{id}
# ---------------------------------------------------------------------------


class TransactionUpdate(BaseModel):
    description: str
    merchant_name: str | None  # None = clear merchant
    category: str | None  # None = clear category/subcategory
    subcategory: str | None  # None = clear subcategory
    notes: str | None  # None = clear notes
    card_number: str | None = None  # None = clear cardholder


@app.patch("/transactions/{transaction_id}")
async def update_transaction(
    transaction_id: int,
    body: TransactionUpdate,
    db: AsyncSession = Depends(get_db),
):
    txq = TransactionQueries(db)
    tx = await txq.get_by_id(transaction_id)
    if tx is None:
        raise HTTPException(status_code=404, detail="Transaction not found")

    tx.description = body.description
    tx.notes = body.notes

    # Merchant
    if body.merchant_name and body.merchant_name.strip():
        merchant = await txq.find_or_create_merchant(body.merchant_name.strip())
        tx.merchant_id = merchant.id
    else:
        tx.merchant_id = None

    # Category + Subcategory
    if (
        body.category
        and body.category.strip()
        and body.subcategory
        and body.subcategory.strip()
    ):
        category = await txq.find_or_create_category(body.category.strip())
        subcategory = await txq.find_or_create_subcategory(
            category.id, body.subcategory.strip()
        )
        tx.subcategory_id = subcategory.id
    else:
        tx.subcategory_id = None

    # CardHolder
    if body.card_number and body.card_number.strip():
        chq = CardHolderQueries(db)
        ch_id = await chq.find_or_create_for_enrichment(body.card_number.strip(), {})
        tx.cardholder_id = ch_id
    else:
        tx.cardholder_id = None

    await db.commit()
    db.expire(tx)
    tx = await txq.get_by_id(transaction_id)
    if tx is None:
        raise HTTPException(status_code=404, detail="Transaction not found")

    return {
        "id": tx.id,
        "date": tx.date.isoformat(),
        "description": tx.description,
        "amount": str(tx.amount),
        "account_id": tx.account_id,
        "account": tx.account.name,
        "merchant": tx.merchant.name if tx.merchant else None,
        "category": tx.subcategory.category.name if tx.subcategory else None,
        "subcategory": tx.subcategory.name if tx.subcategory else None,
        "notes": tx.notes,
        "is_recurring": tx.is_recurring,
        "raw_description": tx.raw_description,
        "cardholder_name": tx.cardholder.name if tx.cardholder else None,
        "card_number": tx.cardholder.card_number if tx.cardholder else None,
    }


class ReEnrichRequest(BaseModel):
    transaction_ids: list[int]


@app.post("/transactions/re-enrich")
async def re_enrich_transactions(
    body: ReEnrichRequest, db: AsyncSession = Depends(get_db)
):
    if not body.transaction_ids:
        return {"items": []}

    txq = TransactionQueries(db)
    transactions = await txq.get_by_ids(body.transaction_ids)
    eligible = [tx for tx in transactions if tx.raw_description]

    if not eligible:
        return {"items": []}

    enrich_input = [
        {
            "index": i,
            "description": tx.raw_description,
            "amount": str(tx.amount),
            "date": str(tx.date),
        }
        for i, tx in enumerate(eligible)
    ]

    try:
        results = await asyncio.to_thread(enricher._enrich_batch, enrich_input, 0)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI enrichment failed: {e}")

    mq = MerchantQueries(db)
    cq = CategoryQueries(db)
    chq = CardHolderQueries(db)
    merchant_cache: dict[str, tuple[int, bool]] = {}
    category_cache: dict[str, int] = {}
    subcategory_cache: dict[tuple, int] = {}
    cardholder_cache: dict[str, int] = {}

    for r in results:
        tx = eligible[r["index"]]

        mname = r.get("merchant_name")
        mlocation = r.get("merchant_location")
        if mname:
            tx.merchant_id = await mq.find_or_create_for_enrichment(
                mname, mlocation, merchant_cache
            )
        else:
            tx.merchant_id = None

        cname = r.get("category")
        scname = r.get("subcategory")
        if cname and scname:
            cid = await cq.find_or_create_for_enrichment(cname, category_cache)
            tx.subcategory_id = await cq.find_or_create_subcategory_for_enrichment(
                cid, scname, subcategory_cache
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

    updated = await txq.get_by_ids([tx.id for tx in eligible])

    return {
        "items": [
            {
                "id": tx.id,
                "date": tx.date.isoformat(),
                "description": tx.description,
                "amount": str(tx.amount),
                "account_id": tx.account_id,
                "account": tx.account.name,
                "merchant": tx.merchant.name if tx.merchant else None,
                "category": tx.subcategory.category.name if tx.subcategory else None,
                "subcategory": tx.subcategory.name if tx.subcategory else None,
                "notes": tx.notes,
                "is_recurring": tx.is_recurring,
                "raw_description": tx.raw_description,
                "cardholder_name": tx.cardholder.name if tx.cardholder else None,
                "card_number": tx.cardholder.card_number if tx.cardholder else None,
            }
            for tx in updated
        ]
    }


class ParseQueryRequest(BaseModel):
    query: str


@app.post("/ai/find-duplicate-merchants")
async def find_duplicate_merchants(db: AsyncSession = Depends(get_db)):
    rows = await MerchantQueries(db).list_for_duplicate_detection()

    if not rows:
        return {"groups": []}

    # Build a lookup for enrichment later
    merchant_map = {
        r.id: {
            "id": r.id,
            "name": r.name,
            "location": r.location,
            "transaction_count": r.transaction_count,
        }
        for r in rows
    }

    # Format for Claude
    lines = []
    for r in rows:
        loc = r.location if r.location else "none"
        lines.append(
            f"ID {r.id} | {r.name} | location: {loc} | {r.transaction_count} transactions"
        )
    merchants_text = "\n".join(lines)

    try:
        result = await asyncio.to_thread(merchant_duplicate_finder.find, merchants_text)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI analysis failed: {e}")

    # Enrich groups with member details
    enriched_groups = []
    for group in result.get("groups", []):
        member_ids = group.get("member_ids", [])
        if len(member_ids) < 2:
            continue
        members = [merchant_map[mid] for mid in member_ids if mid in merchant_map]
        if len(members) < 2:
            continue
        enriched_groups.append(
            {
                "canonical_name": group["canonical_name"],
                "canonical_location": group.get("canonical_location"),
                "members": members,
            }
        )

    return {"groups": enriched_groups}


class MerchantMerge(BaseModel):
    canonical_name: str
    canonical_location: str | None
    merchant_ids: list[int]


@app.post("/merchants/merge")
async def merge_merchants(body: MerchantMerge, db: AsyncSession = Depends(get_db)):
    if len(body.merchant_ids) < 2:
        raise HTTPException(status_code=400, detail="At least 2 merchant IDs required")

    mq = MerchantQueries(db)
    rows = await mq.get_by_ids(body.merchant_ids)

    found_ids = {m.id for m in rows}
    missing = set(body.merchant_ids) - found_ids
    if missing:
        raise HTTPException(
            status_code=404, detail=f"Merchants not found: {sorted(missing)}"
        )

    # Pick winner: prefer merchant whose name matches canonical_name (case-insensitive)
    winner = next(
        (m for m in rows if m.name.lower() == body.canonical_name.lower()),
        rows[0],
    )
    loser_ids = [m.id for m in rows if m.id != winner.id]

    await mq.merge(winner, loser_ids, body.canonical_name, body.canonical_location)
    await db.commit()
    await db.refresh(winner)

    transaction_count, _ = await mq.get_stats(winner.id)

    return {
        "id": winner.id,
        "name": winner.name,
        "location": winner.location,
        "transaction_count": transaction_count,
    }


@app.get("/cardholders")
async def list_cardholders(
    name: str | None = Query(None),
    card_number: str | None = Query(None),
    after: int | None = Query(None, description="Cursor: last seen cardholder ID"),
    limit: int = Query(50, ge=1, le=500),
    sort_by: Literal[
        "name", "card_number", "transaction_count", "total_amount"
    ] = Query("card_number"),
    sort_dir: Literal["asc", "desc"] = Query("asc"),
    db: AsyncSession = Depends(get_db),
):
    items, has_more, next_cursor = await CardHolderQueries(db).paginate(
        name=name,
        card_number=card_number,
        sort_by=sort_by,
        sort_dir=sort_dir,
        limit=limit,
        after_id=after,
    )
    return {
        "items": [
            {
                "id": r.id,
                "name": r.name,
                "card_number": r.card_number,
                "transaction_count": r.transaction_count,
                "total_amount": str(r.total_amount),
            }
            for r in items
        ],
        "has_more": has_more,
        "next_cursor": next_cursor,
    }


class CardHolderUpdate(BaseModel):
    name: str | None
    card_number: str | None


@app.patch("/cardholders/{cardholder_id}")
async def update_cardholder(
    cardholder_id: int, body: CardHolderUpdate, db: AsyncSession = Depends(get_db)
):
    chq = CardHolderQueries(db)
    ch = await chq.get_by_id(cardholder_id)
    if ch is None:
        raise HTTPException(status_code=404, detail="Card holder not found")
    await chq.update(ch, body.name, body.card_number)
    await db.commit()
    row = await chq.get_with_stats(cardholder_id)
    return {
        "id": row.id,
        "name": row.name,
        "card_number": row.card_number,
        "transaction_count": row.transaction_count,
        "total_amount": str(row.total_amount),
    }


@app.post("/ai/parse-query")
async def parse_query_endpoint(
    body: ParseQueryRequest, db: AsyncSession = Depends(get_db)
):
    # Fetch all known categories and subcategories so Claude uses exact strings
    rows = await CategoryQueries(db).list_all()

    # Build a human-readable list: "Food & Drink: Restaurants, Groceries, ..."
    cat_map: dict[str, list[str]] = defaultdict(list)
    for r in rows:
        cat_map[r.cat].append(r.sub)
    categories_text = (
        "\n".join(
            f"- {cat}: {', '.join(subs)}" for cat, subs in sorted(cat_map.items())
        )
        or "(no categories in database yet)"
    )

    try:
        result = await asyncio.to_thread(
            query_parser.parse, body.query, categories_text
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI parsing failed: {e}")

    # Extract explanation separately; remaining keys are filters
    explanation = result.pop("explanation", "")
    filters = {k: v for k, v in result.items() if v is not None}
    # Normalise amounts to strings so they round-trip through URL params
    for key in ("amount_min", "amount_max"):
        if key in filters:
            filters[key] = str(filters[key])

    return {"filters": filters, "explanation": explanation}
