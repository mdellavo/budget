import asyncio
import csv
import hashlib
import io
import logging
import os
from calendar import monthrange
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
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from . import models  # noqa: F401 — ensures models are registered with Base
from .ai import (
    ENRICH_BATCH_SIZE,
    detector,
    enricher,
    merchant_duplicate_finder,
    query_parser,
    report_summarizer,
)
from .auth import create_access_token, get_current_user, verify_password
from .database import AsyncSessionLocal, Base, engine, get_db
from .models import (
    Category,
    Merchant,
    Subcategory,
    Tag,
    Transaction,
    User,
    transaction_tags,
)
from .query import (
    AccountQueries,
    AiSummaryCacheQueries,
    AnalyticsQueries,
    BudgetQueries,
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

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")


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
        try:
            await conn.execute(
                text("ALTER TABLE categories ADD COLUMN classification TEXT")
            )
        except Exception:
            pass  # column already exists
        try:
            await conn.execute(
                text("ALTER TABLE subcategories ADD COLUMN classification TEXT")
            )
        except Exception:
            pass  # column already exists

        # --- Multi-user migrations ---
        # Recreate tables that need user_id NOT NULL + unique constraints
        for table_check, create_sql, insert_sql in [
            (
                "accounts",
                """CREATE TABLE accounts_new (
                    id INTEGER PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    name TEXT NOT NULL,
                    institution TEXT,
                    account_type TEXT,
                    created_at DATETIME NOT NULL,
                    UNIQUE(user_id, name)
                )""",
                "INSERT INTO accounts_new SELECT id, (SELECT MIN(id) FROM users), name, institution, account_type, created_at FROM accounts",
            ),
            (
                "categories",
                """CREATE TABLE categories_new (
                    id INTEGER PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    name TEXT NOT NULL,
                    UNIQUE(user_id, name)
                )""",
                "INSERT INTO categories_new SELECT id, (SELECT MIN(id) FROM users), name FROM categories",
            ),
            (
                "merchants",
                """CREATE TABLE merchants_new (
                    id INTEGER PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    name TEXT NOT NULL,
                    location TEXT,
                    UNIQUE(user_id, name)
                )""",
                "INSERT INTO merchants_new SELECT id, (SELECT MIN(id) FROM users), name, location FROM merchants",
            ),
            (
                "tags",
                """CREATE TABLE tags_new (
                    id INTEGER PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    name TEXT NOT NULL,
                    UNIQUE(user_id, name)
                )""",
                "INSERT INTO tags_new SELECT id, (SELECT MIN(id) FROM users), name FROM tags",
            ),
            (
                "cardholders",
                """CREATE TABLE cardholders_new (
                    id INTEGER PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    name TEXT,
                    card_number TEXT,
                    UNIQUE(user_id, card_number)
                )""",
                "INSERT INTO cardholders_new SELECT id, (SELECT MIN(id) FROM users), name, card_number FROM cardholders",
            ),
            (
                "csv_imports",
                """CREATE TABLE csv_imports_new (
                    id INTEGER PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    account_id INTEGER NOT NULL REFERENCES accounts(id),
                    filename TEXT NOT NULL,
                    imported_at DATETIME NOT NULL,
                    row_count INTEGER NOT NULL,
                    enriched_rows INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'in-progress',
                    column_mapping TEXT
                )""",
                "INSERT INTO csv_imports_new SELECT id, (SELECT MIN(id) FROM users), account_id, filename, imported_at, row_count, enriched_rows, status, column_mapping FROM csv_imports",
            ),
            (
                "transactions",
                """CREATE TABLE transactions_new (
                    id INTEGER PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    account_id INTEGER NOT NULL REFERENCES accounts(id),
                    csv_import_id INTEGER REFERENCES csv_imports(id),
                    date DATE NOT NULL,
                    description TEXT NOT NULL,
                    raw_description TEXT,
                    amount NUMERIC(12, 2) NOT NULL,
                    merchant_id INTEGER REFERENCES merchants(id),
                    subcategory_id INTEGER REFERENCES subcategories(id),
                    cardholder_id INTEGER REFERENCES cardholders(id),
                    notes TEXT,
                    is_recurring BOOLEAN NOT NULL DEFAULT 0,
                    created_at DATETIME NOT NULL
                )""",
                "INSERT INTO transactions_new SELECT id, (SELECT MIN(id) FROM users), account_id, csv_import_id, date, description, raw_description, amount, merchant_id, subcategory_id, cardholder_id, notes, is_recurring, created_at FROM transactions",
            ),
        ]:
            result = await conn.execute(text(f"PRAGMA table_info({table_check})"))
            col_info = {row[1]: row[3] for row in result}
            # Migrate if user_id is missing or nullable (notnull flag == 0)
            if "user_id" not in col_info or col_info.get("user_id") == 0:
                await conn.execute(text(create_sql))
                await conn.execute(text(insert_sql))
                await conn.execute(text(f"DROP TABLE {table_check}"))
                await conn.execute(
                    text(f"ALTER TABLE {table_check}_new RENAME TO {table_check}")
                )

        # Add google_id to users
        try:
            await conn.execute(text("ALTER TABLE users ADD COLUMN google_id TEXT"))
        except Exception:
            pass  # column already exists
        try:
            await conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id "
                    "ON users(google_id) WHERE google_id IS NOT NULL"
                )
            )
        except Exception:
            pass

        try:
            await conn.execute(text("ALTER TABLE merchants ADD COLUMN website TEXT"))
        except Exception:
            pass  # column already exists

        try:
            await conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS budgets (
                        id INTEGER PRIMARY KEY,
                        user_id INTEGER NOT NULL REFERENCES users(id),
                        category_id INTEGER REFERENCES categories(id),
                        subcategory_id INTEGER REFERENCES subcategories(id),
                        amount_limit NUMERIC(12,2) NOT NULL,
                        created_at DATETIME NOT NULL,
                        UNIQUE(user_id, category_id),
                        UNIQUE(user_id, subcategory_id)
                    )
                """
                )
            )
        except Exception:
            pass

        for col_sql in [
            "ALTER TABLE transactions ADD COLUMN is_refund BOOLEAN NOT NULL DEFAULT 0",
            "ALTER TABLE transactions ADD COLUMN is_international BOOLEAN NOT NULL DEFAULT 0",
            "ALTER TABLE transactions ADD COLUMN payment_channel TEXT",
            "ALTER TABLE transactions ADD COLUMN fingerprint TEXT",
            "ALTER TABLE csv_imports ADD COLUMN skipped_duplicates INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE transactions ADD COLUMN is_excluded BOOLEAN NOT NULL DEFAULT 0",
        ]:
            try:
                await conn.execute(text(col_sql))
            except Exception:
                pass

        try:
            await conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ix_transactions_user_fingerprint"
                    " ON transactions(user_id, fingerprint)"
                    " WHERE fingerprint IS NOT NULL"
                )
            )
        except Exception:
            pass

    yield


def _build_category_breakdown(rows: list, prev_rows: list | None = None) -> list[dict]:
    """Build a category→subcategory tree from flat (category, subcategory, total) rows."""
    cat_totals: dict[str, Decimal] = defaultdict(Decimal)
    sub_totals: dict[str, dict[str, Decimal]] = defaultdict(
        lambda: defaultdict(Decimal)
    )
    for r in rows:
        cat_totals[r.category] += r.total
        sub_totals[r.category][r.subcategory] += r.total

    prev_cat: dict[str, Decimal] = defaultdict(Decimal)
    prev_sub: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    for r in prev_rows or []:
        prev_cat[r.category] += r.total
        prev_sub[r.category][r.subcategory] += r.total

    result = []
    for cat in sorted(cat_totals, key=lambda c: cat_totals[c]):
        subs = sorted(
            [
                {
                    "subcategory": sub,
                    "total": str(total),
                    "pct_change": _expenses_pct_change(total, prev_sub[cat][sub]),
                }
                for sub, total in sub_totals[cat].items()
            ],
            key=lambda x: Decimal(str(x["total"])),
        )
        result.append(
            {
                "category": cat,
                "total": str(cat_totals[cat]),
                "pct_change": _expenses_pct_change(cat_totals[cat], prev_cat[cat]),
                "subcategories": subs,
            }
        )
    return result


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class GoogleAuthRequest(BaseModel):
    credential: str


class BudgetCreate(BaseModel):
    category_id: int | None = None
    subcategory_id: int | None = None
    amount_limit: Decimal


class BudgetUpdate(BaseModel):
    amount_limit: Decimal


class BudgetBatchItem(BaseModel):
    category_id: int | None = None
    subcategory_id: int | None = None
    amount_limit: Decimal


class BudgetBatch(BaseModel):
    items: list[BudgetBatchItem]


def _prev_month(month: str) -> str:
    year, mon = int(month[:4]), int(month[5:7])
    if mon == 1:
        return f"{year - 1}-12"
    return f"{year}-{(mon - 1):02d}"


def _prev_year(year: str) -> str:
    return str(int(year) - 1)


def _month_date_range(month: str) -> tuple[str, str]:
    """'2026-02' → ('2026-02-01', '2026-02-28')"""
    year, m = map(int, month.split("-"))
    last = monthrange(year, m)[1]
    return f"{month}-01", f"{month}-{last:02d}"


def _pct_change(new: Decimal, old: Decimal) -> float | None:
    """Return (new-old)/|old|*100, or None when old is zero."""
    if old == 0:
        return None
    return round(float((new - old) / abs(old) * 100), 1)


def _expenses_pct_change(new_exp: Decimal, old_exp: Decimal) -> float | None:
    """Compare absolute spending. Positive = spent more (worse)."""
    if old_exp == 0:
        return None
    return round(float((abs(new_exp) - abs(old_exp)) / abs(old_exp) * 100), 1)


def _format_month_label(month: str) -> str:
    """'2026-02' → 'February 2026'"""
    return datetime.strptime(month, "%Y-%m").strftime("%B %Y")


def _build_monthly_report(
    month: str,
    stats: dict,
    prev_stats: dict,
    rows: list,
    prev_rows: list,
) -> dict:
    income = stats["income"]
    expenses = stats["expenses"]
    net = income + expenses
    prev_income = prev_stats["income"]
    prev_expenses = prev_stats["expenses"]
    prev_net = prev_income + prev_expenses
    savings_rate = float(net / income * 100) if income > 0 else None
    return {
        "month": month,
        "summary": {
            "transaction_count": stats["transaction_count"],
            "income": str(income),
            "expenses": str(expenses),
            "net": str(net),
            "savings_rate": savings_rate,
            "income_pct_change": _pct_change(income, prev_income),
            "expenses_pct_change": _expenses_pct_change(expenses, prev_expenses),
            "net_pct_change": _pct_change(net, prev_net),
        },
        "category_breakdown": _build_category_breakdown(rows, prev_rows),
    }


def _build_yearly_report(
    year: str,
    stats: dict,
    prev_stats: dict,
    rows: list,
    prev_rows: list,
) -> dict:
    income = stats["income"]
    expenses = stats["expenses"]
    net = income + expenses
    prev_income = prev_stats["income"]
    prev_expenses = prev_stats["expenses"]
    prev_net = prev_income + prev_expenses
    savings_rate = float(net / income * 100) if income > 0 else None
    return {
        "year": year,
        "summary": {
            "transaction_count": stats["transaction_count"],
            "income": str(income),
            "expenses": str(expenses),
            "net": str(net),
            "savings_rate": savings_rate,
            "income_pct_change": _pct_change(income, prev_income),
            "expenses_pct_change": _expenses_pct_change(expenses, prev_expenses),
            "net_pct_change": _pct_change(net, prev_net),
        },
        "category_breakdown": _build_category_breakdown(rows, prev_rows),
    }


def _compute_forecast(spent: Decimal, month: str) -> Decimal | None:
    today = date.today()
    current = today.strftime("%Y-%m")
    if month > current:
        return None  # future month
    if month < current:
        return spent  # past month: forecast = actual
    year, mon = int(month[:4]), int(month[5:7])
    days_in = monthrange(year, mon)[1]
    return spent * Decimal(days_in) / Decimal(max(today.day, 1))


def _budget_row_to_dict(row, spent: Decimal, forecast: Decimal | None) -> dict:
    limit = Decimal(row.amount_limit)
    pct = int(spent / limit * 100) if limit > 0 else 0
    forecast_pct: int | None = None
    if forecast is not None:
        forecast_pct = int(forecast / limit * 100) if limit > 0 else 0

    if pct >= 100 or (forecast_pct is not None and forecast_pct >= 100):
        severity = "over"
    elif pct >= 90 or (forecast_pct is not None and forecast_pct >= 90):
        severity = "approaching"
    else:
        severity = None

    if row.category_id is not None:
        name = row.category_name or f"Category {row.category_id}"
        scope = "category"
    else:
        name = row.subcategory_name or f"Subcategory {row.subcategory_id}"
        scope = "subcategory"

    return {
        "id": row.id,
        "name": name,
        "scope": scope,
        "category_id": row.category_id,
        "subcategory_id": row.subcategory_id,
        "amount_limit": str(limit),
        "spent": str(spent),
        "forecast": str(forecast) if forecast is not None else None,
        "pct": pct,
        "forecast_pct": forecast_pct,
        "severity": severity,
    }


@app.post("/auth/login")
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == form_data.username))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_access_token(user.id)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user.id, "email": user.email, "name": user.name},
    }


@app.post("/auth/google")
async def google_login(
    body: GoogleAuthRequest,
    db: AsyncSession = Depends(get_db),
):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google login not configured")
    try:
        id_info = await asyncio.to_thread(
            google_id_token.verify_oauth2_token,
            body.credential,
            google_requests.Request(),
            GOOGLE_CLIENT_ID,
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid Google token")

    google_id = id_info["sub"]
    email: str = id_info.get("email", "")
    name: str = id_info.get("name") or email.split("@")[0]

    # Look up by google_id first, then fall back to email
    result = await db.execute(select(User).where(User.google_id == google_id))
    user = result.scalar_one_or_none()
    if user is None:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()

    if user is None:
        user = User(
            email=email,
            name=name,
            password_hash="!google-oauth",
            google_id=google_id,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    elif user.google_id is None:
        # Link Google ID to an existing password-based account
        user.google_id = google_id
        await db.commit()

    token = create_access_token(user.id)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user.id, "email": user.email, "name": user.name},
    }


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

    async with AsyncSessionLocal() as db:
        csq = CsvImportQueries(db)
        await csq.mark_complete(csv_import_id)
        await db.commit()

    if user_id is not None:
        async with AsyncSessionLocal() as db:
            await AiSummaryCacheQueries(db, user_id=user_id).invalidate_all()
            await db.commit()

    logger.info("Background enrichment complete for csv_import_id=%d", csv_import_id)


FREQUENCY_RANGES = [
    ("weekly", 5, 10),
    ("biweekly", 11, 18),
    ("monthly", 22, 45),
    ("quarterly", 60, 120),
    ("annual", 300, 400),
]
MONTHLY_FACTORS: dict[str, Decimal] = {
    "weekly": Decimal(52) / Decimal(12),
    "biweekly": Decimal(26) / Decimal(12),
    "monthly": Decimal(1),
    "quarterly": Decimal(1) / Decimal(3),
    "annual": Decimal(1) / Decimal(12),
}


def _classify_gap(median_days: float) -> str | None:
    for name, lo, hi in FREQUENCY_RANGES:
        if lo <= median_days <= hi:
            return name
    return None


@app.get("/recurring")
async def get_recurring(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = await AnalyticsQueries(
        db, user_id=current_user.id
    ).get_recurring_transactions(date_from=date_from, date_to=date_to)

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

        amounts = [abs(t.amount) for t in txns]
        median_amount = _median(amounts)
        monthly_cost = median_amount * MONTHLY_FACTORS[frequency]
        next_estimated = dates[-1] + timedelta(days=round(median_gap))

        rep = txns[0]
        results.append(
            {
                "merchant": rep.merchant_name or rep.description,
                "merchant_id": rep.merchant_id,
                "website": rep.merchant_website,
                "category": rep.category_name,
                "subcategory": rep.subcategory_name,
                "amount": str(median_amount.quantize(Decimal("0.01"))),
                "frequency": frequency,
                "occurrences": len(txns),
                "last_charge": dates[-1].isoformat(),
                "next_estimated": next_estimated.isoformat(),
                "monthly_cost": str(monthly_cost.quantize(Decimal("0.01"))),
            }
        )

    results.sort(key=lambda x: Decimal(x["monthly_cost"]), reverse=True)
    return {"items": results}


@app.get("/recurring/summary")
async def get_recurring_summary(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    force: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    period_key = f"{date_from or 'all'}:{date_to or 'all'}"
    cache = AiSummaryCacheQueries(db, user_id=current_user.id)
    if not force:
        cached = await cache.get("recurring", period_key)
        if cached is not None:
            return cached

    rows = await AnalyticsQueries(
        db, user_id=current_user.id
    ).get_recurring_transactions(date_from=date_from, date_to=date_to)

    groups: dict[object, list] = defaultdict(list)
    for r in rows:
        key = (
            r.merchant_id
            if r.merchant_id is not None
            else f"desc:{r.description.strip().lower()}"
        )
        groups[key].append(r)

    items = []
    for txns in groups.values():
        if len(txns) < 2:
            continue
        dates = sorted(t.date for t in txns)
        gaps = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
        median_gap = _median(gaps)
        frequency = _classify_gap(median_gap)
        if frequency is None:
            continue
        amounts = [abs(t.amount) for t in txns]
        median_amount = _median(amounts)
        monthly_cost = median_amount * MONTHLY_FACTORS[frequency]
        rep = txns[0]
        if rep.category_name != "Income":
            items.append(
                {
                    "merchant": rep.merchant_name or rep.description,
                    "category": rep.category_name,
                    "amount": str(median_amount.quantize(Decimal("0.01"))),
                    "frequency": frequency,
                    "monthly_cost": float(monthly_cost.quantize(Decimal("0.01"))),
                }
            )

    items.sort(key=lambda x: x["monthly_cost"], reverse=True)
    total_monthly = sum(x["monthly_cost"] for x in items)

    cat_totals: dict[str, float] = {}
    for item in items:
        cat = item["category"] or "Uncategorized"
        cat_totals[cat] = cat_totals.get(cat, 0.0) + item["monthly_cost"]

    report = {
        "total_monthly_cost": round(total_monthly, 2),
        "total_annual_cost": round(total_monthly * 12, 2),
        "subscription_count": len(items),
        "top_subscriptions": [
            {
                "merchant": x["merchant"],
                "monthly_cost": x["monthly_cost"],
                "frequency": x["frequency"],
            }
            for x in items[:10]
        ],
        "by_category": [
            {"category": cat, "monthly_cost": round(amt, 2)}
            for cat, amt in sorted(cat_totals.items(), key=lambda t: t[1], reverse=True)
        ],
    }

    try:
        result = await asyncio.to_thread(
            report_summarizer.summarize, "Recurring Charges", report
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI summarization failed: {e}")

    await cache.set("recurring", period_key, result)
    await db.commit()
    return result


@app.get("/monthly")
async def list_months(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    months = await AnalyticsQueries(db, user_id=current_user.id).list_months()
    return {"months": months}


@app.get("/monthly/{month}")
async def get_monthly_report(
    month: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    aq = AnalyticsQueries(db, user_id=current_user.id)
    stats, prev_stats, rows, prev_rows = await asyncio.gather(
        aq.get_month_stats(month),
        aq.get_month_stats(_prev_month(month)),
        aq.get_category_breakdown(month),
        aq.get_category_breakdown(_prev_month(month)),
    )
    return _build_monthly_report(month, stats, prev_stats, rows, prev_rows)


@app.get("/monthly/{month}/summary")
async def get_monthly_summary(
    month: str,
    force: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cache = AiSummaryCacheQueries(db, user_id=current_user.id)
    if not force:
        cached = await cache.get("monthly", month)
        if cached is not None:
            return cached

    aq = AnalyticsQueries(db, user_id=current_user.id)
    date_from, date_to = _month_date_range(month)

    stats, prev_stats, rows, prev_rows = await asyncio.gather(
        aq.get_month_stats(month),
        aq.get_month_stats(_prev_month(month)),
        aq.get_category_breakdown(month),
        aq.get_category_breakdown(_prev_month(month)),
    )
    expense_merchants, income_sources, budgets = await asyncio.gather(
        aq.get_expenses_by_merchant(date_from, date_to),
        aq.get_income_by_merchant(date_from, date_to),
        BudgetQueries(db, user_id=current_user.id).list_with_spending(month),
    )

    report = _build_monthly_report(month, stats, prev_stats, rows, prev_rows)

    report["top_expense_merchants"] = [
        {"merchant": r.name, "amount": str(r.total)} for r in expense_merchants[:8]
    ]
    report["income_sources"] = [
        {"source": r.name, "amount": str(r.total)} for r in income_sources[:5]
    ]
    if budgets:
        report["budget_performance"] = [
            {
                "name": b.subcategory_name or b.category_name,
                "limit": str(b.amount_limit),
                "spent": str(b.spent),
                "pct_used": (
                    round(float(abs(b.spent) / b.amount_limit * 100), 1)
                    if b.amount_limit
                    else None
                ),
            }
            for b in budgets
        ]

    try:
        result = await asyncio.to_thread(
            report_summarizer.summarize, _format_month_label(month), report
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI summarization failed: {e}")

    await cache.set("monthly", month, result)
    await db.commit()
    return result


@app.get("/yearly")
async def list_years(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    years = await AnalyticsQueries(db, user_id=current_user.id).list_years()
    return {"years": years}


@app.get("/yearly/{year}")
async def get_yearly_report(
    year: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    aq = AnalyticsQueries(db, user_id=current_user.id)
    stats, prev_stats, rows, prev_rows = await asyncio.gather(
        aq.get_year_stats(year),
        aq.get_year_stats(_prev_year(year)),
        aq.get_year_category_breakdown(year),
        aq.get_year_category_breakdown(_prev_year(year)),
    )
    return _build_yearly_report(year, stats, prev_stats, rows, prev_rows)


@app.get("/yearly/{year}/summary")
async def get_yearly_summary(
    year: str,
    force: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cache = AiSummaryCacheQueries(db, user_id=current_user.id)
    if not force:
        cached = await cache.get("yearly", year)
        if cached is not None:
            return cached

    aq = AnalyticsQueries(db, user_id=current_user.id)
    date_from, date_to = f"{year}-01-01", f"{year}-12-31"
    month_keys = [f"{year}-{m:02d}" for m in range(1, 13)]

    stats, prev_stats, rows, prev_rows = await asyncio.gather(
        aq.get_year_stats(year),
        aq.get_year_stats(_prev_year(year)),
        aq.get_year_category_breakdown(year),
        aq.get_year_category_breakdown(_prev_year(year)),
    )
    expense_merchants, income_sources = await asyncio.gather(
        aq.get_expenses_by_merchant(date_from, date_to),
        aq.get_income_by_merchant(date_from, date_to),
    )
    monthly_stats = list(
        await asyncio.gather(*[aq.get_month_stats(m) for m in month_keys])
    )

    report = _build_yearly_report(year, stats, prev_stats, rows, prev_rows)

    report["top_expense_merchants"] = [
        {"merchant": r.name, "amount": str(r.total)} for r in expense_merchants[:8]
    ]
    report["income_sources"] = [
        {"source": r.name, "amount": str(r.total)} for r in income_sources[:5]
    ]
    report["monthly_trend"] = [
        {
            "month": month_keys[i],
            "income": str(ms["income"]),
            "expenses": str(ms["expenses"]),
            "net": str(ms["income"] + ms["expenses"]),
        }
        for i, ms in enumerate(monthly_stats)
        if ms["transaction_count"] > 0
    ]

    try:
        result = await asyncio.to_thread(report_summarizer.summarize, year, report)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI summarization failed: {e}")

    await cache.set("yearly", year, result)
    await db.commit()
    return result


def _overview_period_key(date_from: str | None, date_to: str | None) -> str:
    if date_from and date_to:
        return f"{date_from}:{date_to}"
    if date_from:
        return f"from:{date_from}"
    if date_to:
        return f"to:{date_to}"
    return "all"


@app.get("/overview/summary")
async def get_overview_summary(
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    force: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    period_key = _overview_period_key(date_from, date_to)
    cache = AiSummaryCacheQueries(db, user_id=current_user.id)

    if not force:
        cached = await cache.get("overview", period_key)
        if cached is not None:
            return cached

    aq = AnalyticsQueries(db, user_id=current_user.id)
    summary = await aq.get_overview_summary(date_from, date_to)
    income_rows, expense_rows, income_cat_rows = await asyncio.gather(
        aq.get_income_by_merchant(date_from, date_to),
        aq.get_expenses_by_category(date_from, date_to),
        aq.get_income_by_category(date_from, date_to),
    )

    income = summary["income"]
    expenses = summary["expenses"]
    net = summary["net"]
    savings_rate = float(net / income * 100) if income > 0 else None

    report = {
        "transaction_count": summary["transaction_count"],
        "income": str(income),
        "expenses": str(expenses),
        "net": str(net),
        "savings_rate": round(savings_rate, 1) if savings_rate is not None else None,
        "top_expense_categories": [
            {"category": r.name, "amount": str(r.total)} for r in expense_rows[:10]
        ],
        "top_income_sources": [
            {"source": r.name, "amount": str(r.total)} for r in income_rows[:8]
        ],
        "income_by_category": [
            {"category": r.name, "amount": str(r.total)} for r in income_cat_rows[:8]
        ],
    }

    if date_from and date_to:
        period_label = f"{date_from} to {date_to}"
    elif date_from:
        period_label = f"from {date_from} onward"
    elif date_to:
        period_label = f"through {date_to}"
    else:
        period_label = "All Time"

    try:
        result = await asyncio.to_thread(
            report_summarizer.summarize, period_label, report
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI summarization failed: {e}")

    await cache.set("overview", period_key, result)
    await db.commit()
    return result


@app.get("/overview")
async def get_overview(
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    aq = AnalyticsQueries(db, user_id=current_user.id)
    summary = await aq.get_overview_summary(date_from, date_to)
    transaction_count = summary["transaction_count"]
    net = summary["net"]
    income = summary["income"]
    expenses = summary["expenses"]
    savings_rate = float(net / income * 100) if income > 0 else None

    # --- sankey: income by merchant ---
    income_rows = await aq.get_income_by_merchant(date_from, date_to)

    # top 8 income sources; collapse rest into "Other Income"
    TOP_INCOME = 8
    income_sources = [
        {"name": r.name, "amount": str(r.total)} for r in income_rows[:TOP_INCOME]
    ]
    if len(income_rows) > TOP_INCOME:
        other_income = sum(r.total for r in income_rows[TOP_INCOME:])
        income_sources.append({"name": "Other Income", "amount": str(other_income)})

    # --- sankey: expenses by category ---
    expense_rows = await aq.get_expenses_by_category(date_from, date_to)

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

    # --- income by category ---
    income_cat_rows = await aq.get_income_by_category(date_from, date_to)
    income_breakdown = [
        {"name": r.name, "amount": str(r.total)}
        for r in income_cat_rows
        if float(r.total) > 0
    ]

    # --- budget warnings ---
    bq = BudgetQueries(db, user_id=current_user.id)
    today = date.today()
    current_month = today.strftime("%Y-%m")
    budget_rows = await bq.list_with_spending(current_month)
    budget_warnings = []
    for brow in budget_rows:
        bspent = Decimal(brow.spent or 0)
        bforecast = _compute_forecast(bspent, current_month)
        bitem = _budget_row_to_dict(brow, bspent, bforecast)
        if bitem["severity"] is not None:
            budget_warnings.append(bitem)

    return {
        "transaction_count": transaction_count,
        "income": str(income),
        "expenses": str(expenses),
        "net": str(net),
        "savings_rate": savings_rate,
        "income_breakdown": income_breakdown,
        "expense_breakdown": expense_breakdown,
        "sankey": {
            "income_sources": income_sources,
            "expense_categories": expense_categories,
        },
        "budget_warnings": budget_warnings,
    }


@app.get("/category-trends")
async def get_category_trends(
    date_from: str | None = None,
    date_to: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = AnalyticsQueries(db, user_id=current_user.id)
    rows = await q.get_category_trends(date_from, date_to)
    return {
        "items": [
            {"month": r.month, "category": r.category, "total": str(r.total)}
            for r in rows
        ]
    }


@app.get("/category-trends/summary")
async def get_trends_summary(
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    force: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    period_key = _overview_period_key(date_from, date_to)
    cache = AiSummaryCacheQueries(db, user_id=current_user.id)
    if not force:
        cached = await cache.get("trends", period_key)
        if cached is not None:
            return cached

    rows = await AnalyticsQueries(db, user_id=current_user.id).get_category_trends(
        date_from, date_to
    )

    # Aggregate totals per category
    cat_totals: dict[str, float] = {}
    monthly_data: dict[str, dict[str, float]] = {}
    for r in rows:
        cat = r.category
        amt = abs(float(r.total))
        cat_totals[cat] = cat_totals.get(cat, 0.0) + amt
        if cat not in monthly_data:
            monthly_data[cat] = {}
        monthly_data[cat][r.month] = amt

    sorted_cats = sorted(cat_totals.items(), key=lambda t: t[1], reverse=True)
    months = sorted(set(r.month for r in rows))

    if date_from and date_to:
        period_label = f"{date_from} to {date_to}"
    elif date_from:
        period_label = f"from {date_from} onward"
    elif date_to:
        period_label = f"through {date_to}"
    else:
        period_label = "All Time"

    report = {
        "period": period_label,
        "months_covered": len(months),
        "top_categories": [
            {"category": cat, "total_spent": round(amt, 2)}
            for cat, amt in sorted_cats[:15]
        ],
        "monthly_breakdown": [
            {
                "month": m,
                "totals": {
                    cat: round(monthly_data[cat].get(m, 0.0), 2)
                    for cat, _ in sorted_cats[:10]
                },
            }
            for m in months[-12:]
        ],
    }

    try:
        result = await asyncio.to_thread(
            report_summarizer.summarize,
            f"Spending Trends — {period_label}",
            report,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI summarization failed: {e}")

    await cache.set("trends", period_key, result)
    await db.commit()
    return result


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
    current_user: User = Depends(get_current_user),
):
    items, has_more, next_cursor = await MerchantQueries(
        db, user_id=current_user.id
    ).paginate(
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
                "website": r.website,
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
        "website": merchant.website,
        "transaction_count": transaction_count,
        "total_amount": str(total_amount),
    }


@app.get("/merchants/{merchant_id}")
async def get_merchant(
    merchant_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mq = MerchantQueries(db, user_id=current_user.id)
    merchant = await mq.get_by_id(merchant_id)
    if merchant is None:
        raise HTTPException(status_code=404, detail="Merchant not found")
    transaction_count, total_amount = await mq.get_stats(merchant_id)
    return _merchant_row(merchant, transaction_count, total_amount)


class MerchantUpdate(BaseModel):
    name: str
    location: str | None
    website: str | None = None


@app.patch("/merchants/{merchant_id}")
async def update_merchant(
    merchant_id: int,
    body: MerchantUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mq = MerchantQueries(db, user_id=current_user.id)
    merchant = await mq.get_by_id(merchant_id)
    if merchant is None:
        raise HTTPException(status_code=404, detail="Merchant not found")
    await mq.update(merchant, body.name, body.location, body.website)
    await db.commit()
    await AiSummaryCacheQueries(db, user_id=current_user.id).invalidate_all()
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
    current_user: User = Depends(get_current_user),
):
    rows = await CategoryQueries(db, user_id=current_user.id).list_with_stats(
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
                "category_id": r.category_id,
                "classification": r.classification,
                "subcategory_id": r.subcategory_id,
                "subcategory_classification": r.subcategory_classification,
            }
            for r in rows
        ]
    }


@app.get("/categories/summary")
async def get_categories_summary(
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    force: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    period_key = _overview_period_key(date_from, date_to)
    cache = AiSummaryCacheQueries(db, user_id=current_user.id)
    if not force:
        cached = await cache.get("categories", period_key)
        if cached is not None:
            return cached

    rows = await CategoryQueries(db, user_id=current_user.id).list_with_stats(
        date_from=date_from,
        date_to=date_to,
        category=None,
        subcategory=None,
        sort_by="total_amount",
        sort_dir="asc",
    )

    cat_map: dict[str, dict] = {}
    for row in rows:
        cat = row.category
        if cat not in cat_map:
            cat_map[cat] = {
                "category": cat,
                "classification": row.classification,
                "total_amount": Decimal(0),
                "transaction_count": 0,
                "subcategories": [],
            }
        cat_map[cat]["total_amount"] += Decimal(str(row.total_amount))
        cat_map[cat]["transaction_count"] += row.transaction_count
        cat_map[cat]["subcategories"].append(
            {
                "name": row.subcategory,
                "total_amount": str(row.total_amount),
                "transaction_count": row.transaction_count,
            }
        )

    sorted_cats = sorted(
        cat_map.values(), key=lambda c: abs(c["total_amount"]), reverse=True
    )
    for c in sorted_cats:
        c["total_amount"] = str(c["total_amount"])

    if date_from and date_to:
        period_label = f"{date_from} to {date_to}"
    elif date_from:
        period_label = f"from {date_from} onward"
    elif date_to:
        period_label = f"through {date_to}"
    else:
        period_label = "All Time"

    report = {
        "period": period_label,
        "categories": sorted_cats[:20],
    }

    try:
        result = await asyncio.to_thread(
            report_summarizer.summarize,
            f"Category Breakdown — {period_label}",
            report,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI summarization failed: {e}")

    await cache.set("categories", period_key, result)
    await db.commit()
    return result


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
    current_user: User = Depends(get_current_user),
):
    items, has_more, next_cursor = await AccountQueries(
        db, user_id=current_user.id
    ).list(
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
    current_user: User = Depends(get_current_user),
):
    items, has_more, next_cursor = await CsvImportQueries(
        db, user_id=current_user.id
    ).list(
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
async def get_import_progress(
    import_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    csv_import = await CsvImportQueries(db, user_id=current_user.id).get_by_id(
        import_id
    )
    if csv_import is None:
        raise HTTPException(status_code=404, detail="Import not found")
    return {
        "csv_import_id": csv_import.id,
        "row_count": csv_import.row_count,
        "enriched_rows": csv_import.enriched_rows,
        "skipped_duplicates": csv_import.skipped_duplicates,
        "complete": csv_import.status == "complete",
        "aborted": csv_import.status == "aborted",
    }


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


@app.post("/imports/{import_id}/abort")
async def abort_import(
    import_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = CsvImportQueries(db, user_id=current_user.id)
    imp = await q.get_by_id(import_id)
    if not imp:
        raise HTTPException(status_code=404, detail="Import not found")
    if imp.status != "in-progress":
        raise HTTPException(
            status_code=409,
            detail=f"Cannot abort import with status '{imp.status}'",
        )
    await q.mark_aborted(import_id)
    return {"status": "aborted", "csv_import_id": import_id}


@app.post("/imports/{import_id}/re-enrich")
async def re_enrich_import(
    import_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    csq = CsvImportQueries(db, user_id=current_user.id)
    csv_import = await csq.get_by_id(import_id)
    if csv_import is None:
        raise HTTPException(status_code=404, detail="Import not found")
    if csv_import.status == "in-progress":
        raise HTTPException(status_code=409, detail="Import is already being enriched")
    await csq.reset_for_reenrichment(import_id)
    await db.commit()
    background_tasks.add_task(_run_reenrichment_for_import, import_id, current_user.id)
    return {"status": "processing", "csv_import_id": import_id}


@app.post("/import-csv")
async def import_csv(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    account_name: str = Form(...),
    account_type: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
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
    aq = AccountQueries(db, user_id=current_user.id)
    account = await aq.find_or_create(account_name)

    if account_type is not None:
        account.account_type = account_type

    # Re-import check: find existing CsvImport by filename
    csq = CsvImportQueries(db, user_id=current_user.id)
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
        current_user.id,
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
    is_refund: bool | None = Query(
        None, description="Filter by refund flag (true/false)"
    ),
    is_international: bool | None = Query(
        None, description="Filter by international flag (true/false)"
    ),
    payment_channel: str | None = Query(
        None,
        description="Filter by payment channel (purchase/refund/fee/interest/p2p/atm/transfer/payroll)",
    ),
    uncategorized: bool | None = Query(
        None, description="true = only transactions with no category/subcategory"
    ),
    cardholder: str | None = Query(
        None,
        description="Case-insensitive substring match on card number or cardholder name",
    ),
    tag: str | None = Query(
        None, description="Filter by tag name (exact, case-insensitive)"
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
    current_user: User = Depends(get_current_user),
):
    txq = TransactionQueries(db, user_id=current_user.id)
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
        is_refund=is_refund,
        is_international=is_international,
        payment_channel=payment_channel,
        uncategorized=uncategorized,
        cardholder=cardholder,
        tag=tag,
    )
    total_count, total_amount = await asyncio.gather(
        txq.count(conditions),
        txq.sum(conditions),
    )
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
                "merchant_website": tx.merchant.website if tx.merchant else None,
                "category": tx.subcategory.category.name if tx.subcategory else None,
                "subcategory": tx.subcategory.name if tx.subcategory else None,
                "notes": tx.notes,
                "is_recurring": tx.is_recurring,
                "is_excluded": tx.is_excluded,
                "is_refund": tx.is_refund,
                "is_international": tx.is_international,
                "payment_channel": tx.payment_channel,
                "raw_description": tx.raw_description,
                "cardholder_name": tx.cardholder.name if tx.cardholder else None,
                "card_number": tx.cardholder.card_number if tx.cardholder else None,
                "tags": [t.name for t in tx.tags],
            }
            for tx in items
        ],
        "has_more": has_more,
        "next_cursor": next_cursor,
        "total_count": total_count,
        "total_amount": str(total_amount),
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
    tags: list[str] = []
    is_excluded: bool | None = None


@app.patch("/transactions/{transaction_id}")
async def update_transaction(
    transaction_id: int,
    body: TransactionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    txq = TransactionQueries(db, user_id=current_user.id)
    tx = await txq.get_by_id(transaction_id)
    if tx is None:
        raise HTTPException(status_code=404, detail="Transaction not found")

    tx.description = body.description
    tx.notes = body.notes
    if body.is_excluded is not None:
        tx.is_excluded = body.is_excluded

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
        chq = CardHolderQueries(db, user_id=current_user.id)
        ch_id = await chq.find_or_create_for_enrichment(body.card_number.strip(), {})
        tx.cardholder_id = ch_id
    else:
        tx.cardholder_id = None

    # Tags
    await txq.set_transaction_tags(tx, body.tags)

    month_key = tx.date.strftime("%Y-%m")
    year_key = str(tx.date.year)
    await db.commit()
    cache = AiSummaryCacheQueries(db, user_id=current_user.id)
    await cache.invalidate_period("monthly", month_key)
    await cache.invalidate_period("yearly", year_key)
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
        "merchant_website": tx.merchant.website if tx.merchant else None,
        "category": tx.subcategory.category.name if tx.subcategory else None,
        "subcategory": tx.subcategory.name if tx.subcategory else None,
        "notes": tx.notes,
        "is_recurring": tx.is_recurring,
        "is_excluded": tx.is_excluded,
        "is_refund": tx.is_refund,
        "is_international": tx.is_international,
        "payment_channel": tx.payment_channel,
        "raw_description": tx.raw_description,
        "cardholder_name": tx.cardholder.name if tx.cardholder else None,
        "card_number": tx.cardholder.card_number if tx.cardholder else None,
        "tags": [t.name for t in tx.tags],
    }


# ---------------------------------------------------------------------------
# GET /transactions/duplicates
# ---------------------------------------------------------------------------


def _serialize_tx(tx: Transaction) -> dict:
    return {
        "id": tx.id,
        "date": tx.date.isoformat(),
        "description": tx.description,
        "amount": str(tx.amount),
        "account_id": tx.account_id,
        "account": tx.account.name,
        "merchant": tx.merchant.name if tx.merchant else None,
        "merchant_website": tx.merchant.website if tx.merchant else None,
        "category": tx.subcategory.category.name if tx.subcategory else None,
        "subcategory": tx.subcategory.name if tx.subcategory else None,
        "notes": tx.notes,
        "is_recurring": tx.is_recurring,
        "is_excluded": tx.is_excluded,
        "is_refund": tx.is_refund,
        "is_international": tx.is_international,
        "payment_channel": tx.payment_channel,
        "raw_description": tx.raw_description,
        "cardholder_name": tx.cardholder.name if tx.cardholder else None,
        "card_number": tx.cardholder.card_number if tx.cardholder else None,
        "tags": [t.name for t in tx.tags],
    }


@app.get("/transactions/duplicates")
async def list_duplicate_transactions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    txq = TransactionQueries(db, user_id=current_user.id)
    groups = await txq.find_duplicates()
    return {"groups": [[_serialize_tx(tx) for tx in group] for group in groups]}


class ReEnrichRequest(BaseModel):
    transaction_ids: list[int]


@app.post("/transactions/re-enrich")
async def re_enrich_transactions(
    body: ReEnrichRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not body.transaction_ids:
        return {"items": []}

    txq = TransactionQueries(db, user_id=current_user.id)
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

    mq = MerchantQueries(db, user_id=current_user.id)
    cq = CategoryQueries(db, user_id=current_user.id)
    chq = CardHolderQueries(db, user_id=current_user.id)
    merchant_cache: dict[str, tuple[int, bool]] = {}
    category_cache: dict[str, int] = {}
    subcategory_cache: dict[tuple, int] = {}
    cardholder_cache: dict[str, int] = {}

    for r in results:
        tx = eligible[r["index"]]

        mname = r.get("merchant_name")
        mlocation = r.get("merchant_location")
        mwebsite = r.get("merchant_website")
        if mname:
            tx.merchant_id = await mq.find_or_create_for_enrichment(
                mname, mlocation, merchant_cache, mwebsite
            )
        else:
            tx.merchant_id = None

        cname = r.get("category")
        scname = r.get("subcategory")
        if cname and scname:
            cid = await cq.find_or_create_for_enrichment(cname, category_cache)
            tx.subcategory_id = await cq.find_or_create_subcategory_for_enrichment(
                cid, scname, subcategory_cache, r.get("need_want")
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
        tx.is_refund = bool(r.get("is_refund", False))
        tx.is_international = bool(r.get("is_international", False))
        tx.payment_channel = r.get("payment_channel")

        tag_names = [
            t.strip().lower() for t in (r.get("suggested_tags") or []) if t.strip()
        ]
        if tag_names:
            await db.flush()
            for tag_name in tag_names:
                tag = await db.scalar(
                    select(Tag).where(
                        Tag.user_id == current_user.id, Tag.name == tag_name
                    )
                )
                if not tag:
                    tag = Tag(user_id=current_user.id, name=tag_name)
                    db.add(tag)
                    await db.flush()
                await db.execute(
                    sqlite_insert(transaction_tags)
                    .values(transaction_id=tx.id, tag_id=tag.id)
                    .on_conflict_do_nothing()
                )

    await db.commit()
    await AiSummaryCacheQueries(db, user_id=current_user.id).invalidate_all()
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
                "merchant_website": tx.merchant.website if tx.merchant else None,
                "category": tx.subcategory.category.name if tx.subcategory else None,
                "subcategory": tx.subcategory.name if tx.subcategory else None,
                "notes": tx.notes,
                "is_recurring": tx.is_recurring,
                "is_excluded": tx.is_excluded,
                "is_refund": tx.is_refund,
                "is_international": tx.is_international,
                "payment_channel": tx.payment_channel,
                "raw_description": tx.raw_description,
                "cardholder_name": tx.cardholder.name if tx.cardholder else None,
                "card_number": tx.cardholder.card_number if tx.cardholder else None,
                "tags": [t.name for t in tx.tags],
            }
            for tx in updated
        ]
    }


@app.get("/tags")
async def list_tags(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    txq = TransactionQueries(db, user_id=current_user.id)
    tags = await txq.list_all_tags()
    return {"items": [t.name for t in tags]}


class ParseQueryRequest(BaseModel):
    query: str


@app.post("/ai/find-duplicate-merchants")
async def find_duplicate_merchants(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = await MerchantQueries(
        db, user_id=current_user.id
    ).list_for_duplicate_detection()

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
async def merge_merchants(
    body: MerchantMerge,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if len(body.merchant_ids) < 2:
        raise HTTPException(status_code=400, detail="At least 2 merchant IDs required")

    mq = MerchantQueries(db, user_id=current_user.id)
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
    await AiSummaryCacheQueries(db, user_id=current_user.id).invalidate_all()
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
    current_user: User = Depends(get_current_user),
):
    items, has_more, next_cursor = await CardHolderQueries(
        db, user_id=current_user.id
    ).paginate(
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
    cardholder_id: int,
    body: CardHolderUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    chq = CardHolderQueries(db, user_id=current_user.id)
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
    body: ParseQueryRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Fetch all known categories and subcategories so Claude uses exact strings
    rows = await CategoryQueries(db, user_id=current_user.id).list_all()

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


@app.get("/categories/all")
async def list_all_categories(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        await db.execute(
            select(
                Category.id.label("category_id"),
                Category.name.label("category_name"),
                Category.classification.label("classification"),
                Subcategory.id.label("subcategory_id"),
                Subcategory.name.label("subcategory_name"),
                Subcategory.classification.label("subcategory_classification"),
            )
            .join(Subcategory, Subcategory.category_id == Category.id)
            .where(Category.user_id == current_user.id)
            .order_by(Category.name, Subcategory.name)
        )
    ).all()
    return {
        "items": [
            {
                "category_id": r.category_id,
                "category_name": r.category_name,
                "classification": r.classification,
                "subcategory_id": r.subcategory_id,
                "subcategory_name": r.subcategory_name,
                "subcategory_classification": r.subcategory_classification,
            }
            for r in rows
        ]
    }


class CategoryUpdate(BaseModel):
    classification: Literal["need", "want"] | None


@app.patch("/categories/{category_id}")
async def update_category(
    category_id: int,
    body: CategoryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cq = CategoryQueries(db, user_id=current_user.id)
    updated = await cq.update_classification(category_id, body.classification)
    if not updated:
        raise HTTPException(status_code=404, detail="Category not found")
    await db.commit()
    await AiSummaryCacheQueries(db, user_id=current_user.id).invalidate_all()
    await db.commit()
    return {"id": category_id, "classification": body.classification}


class SubcategoryUpdate(BaseModel):
    classification: Literal["need", "want"] | None


@app.patch("/subcategories/{subcategory_id}")
async def update_subcategory(
    subcategory_id: int,
    body: SubcategoryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cq = CategoryQueries(db, user_id=current_user.id)
    updated = await cq.update_subcategory_classification(
        subcategory_id, body.classification
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Subcategory not found")
    await db.commit()
    await AiSummaryCacheQueries(db, user_id=current_user.id).invalidate_all()
    await db.commit()
    return {"id": subcategory_id, "classification": body.classification}


@app.get("/budgets")
async def list_budgets(
    month: str | None = Query(None, description="YYYY-MM month (default: current)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if month is None:
        month = date.today().strftime("%Y-%m")
    bq = BudgetQueries(db, user_id=current_user.id)
    rows = await bq.list_with_spending(month)
    items = []
    for row in rows:
        spent = Decimal(row.spent or 0)
        forecast = _compute_forecast(spent, month)
        items.append(_budget_row_to_dict(row, spent, forecast))
    return {"items": items, "month": month}


@app.post("/budgets", status_code=201)
async def create_budget(
    body: BudgetCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    has_cat = body.category_id is not None
    has_sub = body.subcategory_id is not None
    if has_cat == has_sub:
        raise HTTPException(
            status_code=422,
            detail="Exactly one of category_id or subcategory_id must be set",
        )
    if body.amount_limit <= 0:
        raise HTTPException(status_code=422, detail="amount_limit must be positive")
    bq = BudgetQueries(db, user_id=current_user.id)
    try:
        budget = await bq.create(
            category_id=body.category_id,
            subcategory_id=body.subcategory_id,
            amount_limit=body.amount_limit,
        )
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Budget already exists for this category/subcategory",
        )
    # Re-fetch to get names
    rows = await bq.list_with_spending(date.today().strftime("%Y-%m"))
    row = next((r for r in rows if r.id == budget.id), None)
    if row is None:
        return {"id": budget.id}
    spent = Decimal(row.spent or 0)
    forecast = _compute_forecast(spent, date.today().strftime("%Y-%m"))
    return _budget_row_to_dict(row, spent, forecast)


@app.patch("/budgets/{budget_id}")
async def update_budget(
    budget_id: int,
    body: BudgetUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if body.amount_limit <= 0:
        raise HTTPException(status_code=422, detail="amount_limit must be positive")
    bq = BudgetQueries(db, user_id=current_user.id)
    budget = await bq.get(budget_id)
    if budget is None:
        raise HTTPException(status_code=404, detail="Budget not found")
    await bq.update(budget, body.amount_limit)
    await db.commit()
    month = date.today().strftime("%Y-%m")
    rows = await bq.list_with_spending(month)
    row = next((r for r in rows if r.id == budget_id), None)
    if row is None:
        return {"id": budget_id}
    spent = Decimal(row.spent or 0)
    forecast = _compute_forecast(spent, month)
    return _budget_row_to_dict(row, spent, forecast)


@app.delete("/budgets/{budget_id}", status_code=204)
async def delete_budget(
    budget_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    bq = BudgetQueries(db, user_id=current_user.id)
    deleted = await bq.delete(budget_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Budget not found")
    await db.commit()


@app.get("/budgets/wizard")
async def budget_wizard(
    months: int = Query(6, ge=1, le=24),
    scope: Literal["category", "subcategory"] = Query("category"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    aq = AnalyticsQueries(db, user_id=current_user.id)
    bq = BudgetQueries(db, user_id=current_user.id)

    all_months = await aq.list_months()
    look_back = all_months[:months]

    if not look_back:
        return {"items": [], "avg_monthly_income": "0", "months_analyzed": 0}

    total_income = Decimal(0)
    for m in look_back:
        stats = await aq.get_month_stats(m)
        total_income += Decimal(stats["income"])
    avg_income = total_income / len(look_back)

    suggestions = await bq.get_spending_averages(look_back, scope)

    existing = await bq.list_with_spending(date.today().strftime("%Y-%m"))
    budgeted_ids: set[int] = set()
    for row in existing:
        if scope == "category" and row.category_id is not None:
            budgeted_ids.add(row.category_id)
        elif scope == "subcategory" and row.subcategory_id is not None:
            budgeted_ids.add(row.subcategory_id)

    items = []
    for row in suggestions:
        avg = Decimal(row.avg_monthly)
        pct_of_income = float(avg / avg_income * 100) if avg_income > 0 else None
        items.append(
            {
                "id": row.id,
                "name": row.name,
                "scope": scope,
                "avg_monthly": str(avg.quantize(Decimal("0.01"))),
                "pct_of_income": round(pct_of_income, 1) if pct_of_income else None,
                "already_budgeted": row.id in budgeted_ids,
            }
        )

    return {
        "items": items,
        "avg_monthly_income": str(avg_income.quantize(Decimal("0.01"))),
        "months_analyzed": len(look_back),
    }


@app.get("/budgets/{month}/summary")
async def get_budget_summary(
    month: str,
    force: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cache = AiSummaryCacheQueries(db, user_id=current_user.id)
    if not force:
        cached = await cache.get("budget", month)
        if cached is not None:
            return cached

    bq = BudgetQueries(db, user_id=current_user.id)
    aq = AnalyticsQueries(db, user_id=current_user.id)
    rows, stats = await asyncio.gather(
        bq.list_with_spending(month),
        aq.get_month_stats(month),
    )

    budget_items = []
    for row in rows:
        spent = Decimal(row.spent or 0)
        forecast = _compute_forecast(spent, month)
        d = _budget_row_to_dict(row, spent, forecast)
        budget_items.append(
            {
                "name": d["name"],
                "limit": d["amount_limit"],
                "spent": d["spent"],
                "pct_used": d["pct"],
                "severity": d["severity"],
                "forecast": d["forecast"],
            }
        )

    report = {
        "month": month,
        "income": str(stats["income"]),
        "expenses": str(stats["expenses"]),
        "budgets": budget_items,
    }

    try:
        result = await asyncio.to_thread(
            report_summarizer.summarize,
            f"Budget — {_format_month_label(month)}",
            report,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI summarization failed: {e}")

    await cache.set("budget", month, result)
    await db.commit()
    return result


@app.post("/budgets/batch", status_code=201)
async def create_budgets_batch(
    body: BudgetBatch,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    bq = BudgetQueries(db, user_id=current_user.id)

    existing_rows = await bq.list_with_spending(date.today().strftime("%Y-%m"))
    existing_cat_ids = {
        r.category_id for r in existing_rows if r.category_id is not None
    }
    existing_sub_ids = {
        r.subcategory_id for r in existing_rows if r.subcategory_id is not None
    }

    created = 0
    skipped = 0
    for item in body.items:
        has_cat = item.category_id is not None
        has_sub = item.subcategory_id is not None
        if has_cat == has_sub or item.amount_limit <= 0:
            skipped += 1
            continue
        if has_cat and item.category_id in existing_cat_ids:
            skipped += 1
            continue
        if has_sub and item.subcategory_id in existing_sub_ids:
            skipped += 1
            continue
        await bq.create(item.category_id, item.subcategory_id, item.amount_limit)
        created += 1

    await db.commit()
    return {"created": created, "skipped": skipped}
