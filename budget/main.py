import asyncio
import csv
import io
import json
import logging
import time
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from statistics import median as _median
from typing import Literal

import anthropic
from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import and_, delete, func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .database import AsyncSessionLocal, Base, engine, get_db
from . import models  # noqa: F401 — ensures models are registered with Base
from .models import Account, Category, CsvImport, Merchant, Subcategory, Transaction

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        try:
            await conn.execute(text(
                "ALTER TABLE csv_imports ADD COLUMN enriched_rows INTEGER NOT NULL DEFAULT 0"
            ))
        except Exception:
            pass  # column already exists on fresh or previously-migrated DB
        try:
            await conn.execute(text("ALTER TABLE merchants ADD COLUMN location TEXT"))
        except Exception:
            pass  # column already exists
        try:
            await conn.execute(text(
                "ALTER TABLE transactions ADD COLUMN is_recurring BOOLEAN NOT NULL DEFAULT 0"
            ))
        except Exception:
            pass  # column already exists
        try:
            await conn.execute(text(
                "ALTER TABLE csv_imports ADD COLUMN status TEXT NOT NULL DEFAULT 'complete'"
            ))
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

SAMPLE_ROWS = 5

KNOWN_COLUMNS = ["description", "date", "amount"]

PROMPT_TEMPLATE = """You are a CSV column mapping assistant. Given a sample of CSV data, your job is to map the CSV's columns to a set of known target columns.

Target columns:
- description: A text description or memo of the transaction
- date: The date the transaction occurred
- amount: The monetary value of the transaction (positive or negative)

Instructions:
1. Analyze the provided CSV headers and sample rows
2. For each target column, identify the best matching CSV column
3. If no match exists for a target column, set it to null
4. A single CSV column can only map to one target column
5. Return your answer as a JSON object mapping target columns to CSV column index, zero based

CSV Data:
{csv_sample}"""

COLUMN_MAPPING_SCHEMA = {
    "type": "object",
    "properties": {
        "description": {"type": ["integer", "null"], "description": "Zero-based index of the column containing the transaction description or memo"},
        "date": {"type": ["integer", "null"], "description": "Zero-based index of the column containing the transaction date"},
        "amount": {"type": ["integer", "null"], "description": "Zero-based index of the column containing the transaction amount"},
    },
    "required": ["description", "date", "amount"],
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


class ColumnDetector:
    def __init__(self):
        self.client = anthropic.Anthropic()

    def _build_csv_sample(self, fieldnames: list[str], rows: list[dict]) -> str:
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows[:SAMPLE_ROWS])
        return output.getvalue()

    def detect(self, fieldnames: list[str], rows: list[dict]) -> dict[str, str | None]:
        csv_sample = self._build_csv_sample(fieldnames, rows)
        prompt = PROMPT_TEMPLATE.format(csv_sample=csv_sample)

        message = self.client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=256,
            messages=[{"role": "user", "content": prompt}],
            tools=[{
                "name": "map_columns",
                "description": "Map CSV columns to known target columns by their zero-based index",
                "input_schema": COLUMN_MAPPING_SCHEMA,
            }],
            tool_choice={"type": "tool", "name": "map_columns"},
        )

        tool_use = next(block for block in message.content if block.type == "tool_use")
        mapping = tool_use.input

        return {col: mapping.get(col) for col in KNOWN_COLUMNS}


detector = ColumnDetector()


ENRICHMENT_PROMPT = """\
You are a personal finance assistant. You will be given a list of bank transaction descriptions and must identify the merchant, spending category, and subcategory for each one.

Bank descriptions are often truncated, uppercased, and contain store numbers or location codes. Use your knowledge to resolve unfamiliar merchants.

Spending categories and subcategories to use (pick the best fit):

Food & Drink: Restaurants, Groceries, Coffee & Tea, Fast Food, Bars & Alcohol
Shopping: Online Shopping, Clothing, Electronics, Home & Garden, Department Stores
Transportation: Gas & Fuel, Rideshare, Parking, Public Transit, Auto Maintenance
Entertainment: Streaming, Movies & Theater, Games, Events & Concerts
Health & Fitness: Gym, Medical, Pharmacy, Dental, Vision
Travel: Hotels, Flights, Car Rental, Vacation Packages
Bills & Utilities: Electricity, Internet, Phone, Insurance, Subscriptions
Income: Paycheck, Transfer In, Refund, Interest Income, Reimbursement
Personal Care: Hair & Beauty, Spa, Clothing Care
Home: Rent, Mortgage, Home Services, Furniture
Financial: Bank Fees, ATM, Investment, Loan Payment
Other: anything that doesn't fit above

Rules:
- merchant_name: canonical business name, Title Case, no location codes or store numbers
  e.g. "STARBUCKS #4821 SEATTLE WA" → "Starbucks"
  e.g. "AMZN MKTP US*1A2B3" → "Amazon"
- is_recurring: true if (a) the description explicitly contains words like "recurring", "subscription",
  "membership", "autopay", "autorenew", or similar; OR (b) the merchant is clearly a subscription
  or regularly-recurring service (streaming, SaaS, rent, gym, insurance, utilities).
  false for one-off purchases: restaurants, retail, rideshare, ATM, etc.
  e.g. "RECURRING PAYMENT GEICO" → true  (explicit keyword)
  e.g. "AUTOPAY VERIZON WIRELESS" → true  (explicit keyword)
  e.g. "NETFLIX.COM" → true  (known subscription)
  e.g. "SPOTIFY USA" → true
  e.g. "APPLE.COM/BILL" → true
  e.g. "GITHUB" → true
  e.g. "STARBUCKS #4821" → false
  e.g. "AMAZON.COM*1A2B3" → false
  e.g. "UBER TRIP" → false
- merchant_location: extract location from the raw description only if explicitly present.
  Format "City, ST" for US (e.g. "Seattle, WA"), "City, Country" for international.
  If no location appears in the raw text, set to null. Do NOT infer from general knowledge.
  e.g. "STARBUCKS #4821 SEATTLE WA" → "Seattle, WA"
  e.g. "AMZN MKTP US*1A2B3" → null
  e.g. "SQ *FARMERS MARKET BROOKLYN NY" → "Brooklyn, NY"
- description: a short, human-readable summary of the transaction, Title Case
  Strip noise (store numbers, location codes, transaction IDs). If the raw description is already clean, keep it.
  e.g. "STARBUCKS #4821 SEATTLE WA" → "Starbucks Coffee"
  e.g. "SQ *FARMERS MARKET 123" → "Farmers Market"
  e.g. "GITHUB.COM/SPONSORS" → "GitHub Sponsors"
- Positive amounts are typically income/credits; negative amounts are expenses.
- If a merchant cannot be identified, set merchant_name to null.
- subcategory must be one of the values listed under the chosen category above.
- Return a result for every transaction index provided — do not skip any.

Transactions:
{transactions}"""

ENRICHMENT_SCHEMA = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index":             {"type": "integer"},
                    "merchant_name":     {"type": ["string", "null"]},
                    "merchant_location": {"type": ["string", "null"]},
                    "is_recurring":      {"type": "boolean"},
                    "description":       {"type": "string"},
                    "category":          {"type": ["string", "null"]},
                    "subcategory":       {"type": ["string", "null"]},
                },
                "required": ["index", "merchant_name", "merchant_location", "is_recurring", "description", "category", "subcategory"],
            },
        }
    },
    "required": ["results"],
}

ENRICH_BATCH_SIZE = 50


class TransactionEnricher:
    def __init__(self):
        self.client = anthropic.Anthropic()

    def _enrich_batch(self, batch: list[dict], batch_num: int) -> list[dict]:
        start = time.perf_counter()
        logger.info(
            "Enrichment batch %d starting: %d rows (indices %d–%d)",
            batch_num, len(batch), batch[0]["index"], batch[-1]["index"],
        )
        tx_text = "\n".join(
            f"{r['index']}. [{r['date']}] {r['description']}  (amount: {r['amount']})"
            for r in batch
        )
        prompt = ENRICHMENT_PROMPT.format(transactions=tx_text)
        messages = [{"role": "user", "content": prompt}]
        tools = [
            {
                "name": "enrich_transactions",
                "description": "Return enriched merchant/category/subcategory for each transaction",
                "input_schema": ENRICHMENT_SCHEMA,
            },
        ]

        while True:
            response = self.client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=4096,
                tools=tools,
                tool_choice={"type": "any"},
                messages=messages,
            )

            # Done — extract structured result
            for block in response.content:
                if block.type == "tool_use" and block.name == "enrich_transactions":
                    results = block.input["results"]
                    elapsed = time.perf_counter() - start
                    logger.info("Enrichment batch %d complete in %.2fs", batch_num, elapsed)
                    return results

            # Model used web_search or other tool — continue the loop
            if response.stop_reason != "tool_use":
                raise RuntimeError("Enrichment model did not call enrich_transactions")

            messages.append({"role": "assistant", "content": response.content})
            tool_results = [
                {"type": "tool_result", "tool_use_id": b.id, "content": ""}
                for b in response.content
                if b.type == "tool_use"
            ]
            messages.append({"role": "user", "content": tool_results})


enricher = TransactionEnricher()


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
    logger.info("Background enrichment starting for csv_import_id=%d (%d rows)", csv_import_id, len(rows))

    batches = [enrich_input[i : i + ENRICH_BATCH_SIZE] for i in range(0, len(enrich_input), ENRICH_BATCH_SIZE)]
    sem = asyncio.Semaphore(3)

    async def fetch_batch(batch, batch_num):
        for attempt in range(1, 4):  # attempts 1, 2, 3
            async with sem:
                try:
                    return await asyncio.to_thread(enricher._enrich_batch, batch, batch_num)
                except Exception:
                    if attempt == 3:
                        raise
                    logger.warning(
                        "Batch %d attempt %d/%d failed for csv_import_id=%d, retrying…",
                        batch_num, attempt, 3, csv_import_id,
                    )
            await asyncio.sleep(2 ** attempt)  # 2s, 4s between retries (outside sem)

    tasks = [asyncio.create_task(fetch_batch(batch, i)) for i, batch in enumerate(batches)]

    async with AsyncSessionLocal() as db:
        merchant_cache: dict[str, tuple[int, bool]] = {}  # name → (id, has_location)
        category_cache: dict[str, int] = {}
        subcategory_cache: dict[tuple, int] = {}

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
                    logger.warning("csv_import_id=%d row %d parse error: %s", csv_import_id, i, e)
                    continue

                mname = r.get("merchant_name")
                mlocation = r.get("merchant_location")
                cname = r.get("category")
                scname = r.get("subcategory")

                merchant_id = None
                if mname:
                    if mname not in merchant_cache:
                        res = await db.execute(select(Merchant).where(Merchant.name == mname))
                        m = res.scalar_one_or_none()
                        if m is None:
                            m = Merchant(name=mname, location=mlocation)
                            db.add(m)
                            await db.flush()
                            merchant_cache[mname] = (m.id, mlocation is not None)
                        else:
                            if m.location is None and mlocation is not None:
                                m.location = mlocation
                                await db.flush()
                            merchant_cache[mname] = (m.id, m.location is not None)
                    else:
                        cached_id, has_location = merchant_cache[mname]
                        if not has_location and mlocation is not None:
                            await db.execute(
                                update(Merchant).where(Merchant.id == cached_id).values(location=mlocation)
                            )
                            await db.flush()
                            merchant_cache[mname] = (cached_id, True)
                    merchant_id = merchant_cache[mname][0]

                category_id = None
                if cname:
                    if cname not in category_cache:
                        res = await db.execute(select(Category).where(Category.name == cname))
                        c = res.scalar_one_or_none() or Category(name=cname)
                        if c.id is None:
                            db.add(c)
                            await db.flush()
                        category_cache[cname] = c.id
                    category_id = category_cache[cname]

                subcategory_id = None
                if cname and scname:
                    key = (category_id, scname)
                    if key not in subcategory_cache:
                        res = await db.execute(
                            select(Subcategory).where(
                                Subcategory.category_id == category_id,
                                Subcategory.name == scname,
                            )
                        )
                        sc = res.scalar_one_or_none() or Subcategory(category_id=category_id, name=scname)
                        if sc.id is None:
                            db.add(sc)
                            await db.flush()
                        subcategory_cache[key] = sc.id
                    subcategory_id = subcategory_cache[key]

                description = r.get("description") or (row[desc_col].strip() if desc_col else "")
                is_recurring = bool(r.get("is_recurring", False))
                db.add(Transaction(
                    account_id=account_id,
                    csv_import_id=csv_import_id,
                    date=date_val,
                    description=description,
                    amount=amount_val,
                    merchant_id=merchant_id,
                    subcategory_id=subcategory_id,
                    is_recurring=is_recurring,
                ))

            await db.commit()

            await db.execute(
                update(CsvImport)
                .where(CsvImport.id == csv_import_id)
                .values(enriched_rows=CsvImport.enriched_rows + attempted)
            )
            await db.commit()

    async with AsyncSessionLocal() as db:
        await db.execute(
            update(CsvImport)
            .where(CsvImport.id == csv_import_id)
            .values(status="complete")
        )
        await db.commit()

    logger.info("Background enrichment complete for csv_import_id=%d", csv_import_id)


FREQUENCY_RANGES = [
    ("weekly",    5,   10),
    ("biweekly",  11,  18),
    ("monthly",   22,  45),
    ("quarterly", 60,  120),
    ("annual",    300, 400),
]
MONTHLY_FACTORS = {
    "weekly": 52 / 12, "biweekly": 26 / 12,
    "monthly": 1, "quarterly": 1 / 3, "annual": 1 / 12,
}


def _classify_gap(median_days: float) -> str | None:
    for name, lo, hi in FREQUENCY_RANGES:
        if lo <= median_days <= hi:
            return name
    return None


@app.get("/recurring")
async def get_recurring(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(
            Transaction.date,
            Transaction.amount,
            Transaction.merchant_id,
            Transaction.description,
            Merchant.name.label("merchant_name"),
            Category.name.label("category_name"),
        )
        .outerjoin(Merchant, Transaction.merchant_id == Merchant.id)
        .outerjoin(Subcategory, Transaction.subcategory_id == Subcategory.id)
        .outerjoin(Category, Subcategory.category_id == Category.id)
        .where(Transaction.is_recurring == True)
        .order_by(Transaction.date)
    )).all()

    groups: dict[object, list] = defaultdict(list)
    for r in rows:
        key = r.merchant_id if r.merchant_id is not None else f"desc:{r.description.strip().lower()}"
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
        results.append({
            "merchant":       rep.merchant_name or rep.description,
            "merchant_id":    rep.merchant_id,
            "category":       rep.category_name,
            "amount":         str(round(median_amount, 2)),
            "frequency":      frequency,
            "occurrences":    len(txns),
            "last_charge":    dates[-1].isoformat(),
            "next_estimated": next_estimated.isoformat(),
            "monthly_cost":   str(round(monthly_cost, 2)),
        })

    results.sort(key=lambda x: float(x["monthly_cost"]), reverse=True)
    return {"items": results}


@app.get("/monthly")
async def list_months(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(func.strftime('%Y-%m', Transaction.date).label("month"))
        .group_by(func.strftime('%Y-%m', Transaction.date))
        .order_by(text("month DESC"))
    )).all()
    return {"months": [r.month for r in rows]}


@app.get("/monthly/{month}")
async def get_monthly_report(month: str, db: AsyncSession = Depends(get_db)):
    month_filter = func.strftime('%Y-%m', Transaction.date) == month

    transaction_count = await db.scalar(
        select(func.count(Transaction.id)).where(month_filter)
    ) or 0
    income = await db.scalar(
        select(func.coalesce(func.sum(Transaction.amount), 0))
        .where(month_filter, Transaction.amount > 0)
    ) or Decimal(0)
    expenses = await db.scalar(
        select(func.coalesce(func.sum(Transaction.amount), 0))
        .where(month_filter, Transaction.amount < 0)
    ) or Decimal(0)
    net = income + expenses  # expenses is negative
    savings_rate = float(net / income * 100) if income > 0 else None

    # Category + subcategory breakdown for expenses
    rows = (await db.execute(
        select(
            func.coalesce(Category.name, "Uncategorized").label("category"),
            func.coalesce(Subcategory.name, "Uncategorized").label("subcategory"),
            func.sum(Transaction.amount).label("total"),
        )
        .select_from(Transaction)
        .outerjoin(Subcategory, Transaction.subcategory_id == Subcategory.id)
        .outerjoin(Category, Subcategory.category_id == Category.id)
        .where(month_filter, Transaction.amount < 0)
        .group_by(Category.name, Subcategory.name)
        .order_by(func.sum(Transaction.amount).asc())  # most negative first
    )).all()

    # Build category → subcategory tree
    cat_totals: dict[str, Decimal] = defaultdict(Decimal)
    cat_subs: dict[str, list] = defaultdict(list)
    for r in rows:
        cat_totals[r.category] += r.total
        cat_subs[r.category].append({"subcategory": r.subcategory, "total": str(r.total)})

    category_breakdown = [
        {
            "category": cat,
            "total": str(cat_totals[cat]),
            "subcategories": sorted(cat_subs[cat], key=lambda x: float(x["total"])),
        }
        for cat in sorted(cat_totals, key=lambda c: float(cat_totals[c]))  # most negative first
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
    # --- existing scalar queries (unchanged) ---
    transaction_count = await db.scalar(select(func.count(Transaction.id))) or 0
    net = await db.scalar(
        select(func.coalesce(func.sum(Transaction.amount), 0))
    ) or Decimal(0)
    income = await db.scalar(
        select(func.coalesce(func.sum(Transaction.amount), 0)).where(Transaction.amount > 0)
    ) or Decimal(0)
    expenses = net - income
    savings_rate = float(net / income * 100) if income > 0 else None

    # --- sankey: income by merchant ---
    income_rows = (await db.execute(
        select(
            func.coalesce(Merchant.name, "Other Income").label("name"),
            func.sum(Transaction.amount).label("total"),
        )
        .select_from(Transaction)
        .outerjoin(Merchant, Transaction.merchant_id == Merchant.id)
        .where(Transaction.amount > 0)
        .group_by(Merchant.name)
        .order_by(func.sum(Transaction.amount).desc())
    )).all()

    # top 8 income sources; collapse rest into "Other Income"
    TOP_INCOME = 8
    income_sources = [{"name": r.name, "amount": str(r.total)} for r in income_rows[:TOP_INCOME]]
    if len(income_rows) > TOP_INCOME:
        other_income = sum(r.total for r in income_rows[TOP_INCOME:])
        income_sources.append({"name": "Other Income", "amount": str(other_income)})

    # --- sankey: expenses by category ---
    expense_rows = (await db.execute(
        select(
            func.coalesce(Category.name, "Uncategorized").label("name"),
            func.sum(Transaction.amount).label("total"),
        )
        .select_from(Transaction)
        .outerjoin(Subcategory, Transaction.subcategory_id == Subcategory.id)
        .outerjoin(Category, Subcategory.category_id == Category.id)
        .where(Transaction.amount < 0)
        .group_by(Category.name)
        .order_by(func.sum(Transaction.amount))   # most negative first
    )).all()

    # top 14 expense categories; collapse rest into "Other Expenses"
    TOP_EXPENSES = 14
    expense_categories = [{"name": r.name, "amount": str(r.total)} for r in expense_rows[:TOP_EXPENSES]]
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
        "income":            str(income),
        "expenses":          str(expenses),
        "net":               str(net),
        "savings_rate":      savings_rate,
        "expense_breakdown": expense_breakdown,
        "sankey": {
            "income_sources":     income_sources,
            "expense_categories": expense_categories,
        },
    }


@app.get("/merchants")
async def list_merchants(
    name:     str     | None = Query(None, description="Case-insensitive substring match on merchant name"),
    location: str     | None = Query(None, description="Case-insensitive substring match on merchant location"),
    after:    int     | None = Query(None, description="Cursor: last seen merchant ID"),
    limit:    int            = Query(50, ge=1, le=500),
    sort_by:  Literal["name", "transaction_count", "total_amount"] = Query("name"),
    sort_dir: Literal["asc", "desc"] = Query("asc"),
    db: AsyncSession = Depends(get_db),
):
    txn_count_expr = (
        select(func.count(Transaction.id))
        .where(Transaction.merchant_id == Merchant.id)
        .correlate(Merchant)
        .scalar_subquery()
    )
    txn_total_expr = (
        select(func.coalesce(func.sum(Transaction.amount), 0))
        .where(Transaction.merchant_id == Merchant.id)
        .correlate(Merchant)
        .scalar_subquery()
    )
    sort_expr = {
        "name":              Merchant.name,
        "transaction_count": txn_count_expr,
        "total_amount":      txn_total_expr,
    }[sort_by]

    if sort_dir == "desc":
        order_clauses = [sort_expr.desc().nulls_last(), Merchant.id.desc()]
    else:
        order_clauses = [sort_expr.asc().nulls_last(), Merchant.id.asc()]

    conditions = []
    if name:
        conditions.append(Merchant.name.ilike(f"%{name}%"))
    if location:
        conditions.append(Merchant.location.ilike(f"%{location}%"))

    if after is not None:
        cur = await db.get(Merchant, after)
        if sort_by == "transaction_count":
            cursor_val = await db.scalar(
                select(func.count(Transaction.id)).where(Transaction.merchant_id == after)
            )
        elif sort_by == "total_amount":
            cursor_val = await db.scalar(
                select(func.coalesce(func.sum(Transaction.amount), 0))
                .where(Transaction.merchant_id == after)
            )
        else:
            cursor_val = cur.name

        id_cmp = (Merchant.id < after) if sort_dir == "desc" else (Merchant.id > after)
        if cursor_val is None:
            conditions.append(and_(sort_expr.is_(None), id_cmp))
        else:
            beyond = (sort_expr < cursor_val) if sort_dir == "desc" else (sort_expr > cursor_val)
            tied   = and_(sort_expr == cursor_val, id_cmp)
            conditions.append(or_(beyond, tied, sort_expr.is_(None)))

    rows = (await db.execute(
        select(
            Merchant.id,
            Merchant.name,
            Merchant.location,
            txn_count_expr.label("transaction_count"),
            txn_total_expr.label("total_amount"),
        )
        .where(*conditions)
        .order_by(*order_clauses)
        .limit(limit + 1)
    )).all()

    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = items[-1].id if has_more and items else None

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


@app.get("/categories")
async def list_categories(
    date_from:   str | None = Query(None),
    date_to:     str | None = Query(None),
    category:    str | None = Query(None, description="Case-insensitive substring match"),
    subcategory: str | None = Query(None, description="Case-insensitive substring match"),
    sort_by:     Literal["category", "subcategory", "transaction_count", "total_amount"] = Query("category"),
    sort_dir:    Literal["asc", "desc"] = Query("asc"),
    db: AsyncSession = Depends(get_db),
):
    conditions = []
    if date_from:
        conditions.append(Transaction.date >= date_from)
    if date_to:
        conditions.append(Transaction.date <= date_to)
    if category:
        conditions.append(Category.name.ilike(f"%{category}%"))
    if subcategory:
        conditions.append(Subcategory.name.ilike(f"%{subcategory}%"))

    cat_expr   = func.coalesce(Category.name, "Uncategorized")
    sub_expr   = func.coalesce(Subcategory.name, "Uncategorized")
    count_expr = func.count(Transaction.id)
    total_expr = func.coalesce(func.sum(Transaction.amount), 0)

    sort_map = {
        "category":          cat_expr,
        "subcategory":       sub_expr,
        "transaction_count": count_expr,
        "total_amount":      total_expr,
    }
    order_expr   = sort_map[sort_by]
    order_clause = order_expr.desc() if sort_dir == "desc" else order_expr.asc()

    rows = (await db.execute(
        select(
            cat_expr.label("category"),
            sub_expr.label("subcategory"),
            count_expr.label("transaction_count"),
            total_expr.label("total_amount"),
        )
        .select_from(Transaction)
        .outerjoin(Subcategory, Transaction.subcategory_id == Subcategory.id)
        .outerjoin(Category, Subcategory.category_id == Category.id)
        .where(*conditions)
        .group_by(Category.name, Subcategory.name)
        .order_by(order_clause)
    )).all()

    return {
        "items": [
            {
                "category":          r.category,
                "subcategory":       r.subcategory,
                "transaction_count": r.transaction_count,
                "total_amount":      str(r.total_amount),
            }
            for r in rows
        ]
    }


@app.get("/accounts")
async def list_accounts(
    name:         str     | None = Query(None, description="Case-insensitive substring match on account name"),
    institution:  str     | None = Query(None, description="Case-insensitive substring match on institution"),
    account_type: str     | None = Query(None, description="Case-insensitive substring match on account type"),
    after:        int     | None = Query(None, description="Cursor: last seen account ID"),
    limit:        int            = Query(50, ge=1, le=500),
    sort_by:      Literal["name", "institution", "account_type", "created_at", "transaction_count", "total_amount"] = Query("name"),
    sort_dir:     Literal["asc", "desc"] = Query("asc"),
    db: AsyncSession = Depends(get_db),
):
    txn_count_expr = (
        select(func.count(Transaction.id))
        .where(Transaction.account_id == Account.id)
        .correlate(Account)
        .scalar_subquery()
    )
    txn_total_expr = (
        select(func.coalesce(func.sum(Transaction.amount), 0))
        .where(Transaction.account_id == Account.id)
        .correlate(Account)
        .scalar_subquery()
    )
    sort_expr = {
        "name":              Account.name,
        "institution":       Account.institution,
        "account_type":      Account.account_type,
        "created_at":        Account.created_at,
        "transaction_count": txn_count_expr,
        "total_amount":      txn_total_expr,
    }[sort_by]

    if sort_dir == "desc":
        order_clauses = [sort_expr.desc().nulls_last(), Account.id.desc()]
    else:
        order_clauses = [sort_expr.asc().nulls_last(), Account.id.asc()]

    conditions = []
    if name:
        conditions.append(Account.name.ilike(f"%{name}%"))
    if institution:
        conditions.append(Account.institution.ilike(f"%{institution}%"))
    if account_type:
        conditions.append(Account.account_type.ilike(f"%{account_type}%"))

    if after is not None:
        cur = await db.get(Account, after)
        if sort_by == "transaction_count":
            cursor_val = await db.scalar(
                select(func.count(Transaction.id)).where(Transaction.account_id == after)
            )
        elif sort_by == "total_amount":
            cursor_val = await db.scalar(
                select(func.coalesce(func.sum(Transaction.amount), 0))
                .where(Transaction.account_id == after)
            )
        else:
            cursor_val = getattr(cur, sort_by)  # name, institution, account_type, or created_at

        id_cmp = (Account.id < after) if sort_dir == "desc" else (Account.id > after)
        if cursor_val is None:
            conditions.append(and_(sort_expr.is_(None), id_cmp))
        else:
            beyond = (sort_expr < cursor_val) if sort_dir == "desc" else (sort_expr > cursor_val)
            tied   = and_(sort_expr == cursor_val, id_cmp)
            conditions.append(or_(beyond, tied, sort_expr.is_(None)))

    rows = (await db.execute(
        select(
            Account.id,
            Account.name,
            Account.institution,
            Account.account_type,
            Account.created_at,
            txn_count_expr.label("transaction_count"),
            txn_total_expr.label("total_amount"),
        )
        .where(*conditions)
        .order_by(*order_clauses)
        .limit(limit + 1)
    )).all()

    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = items[-1].id if has_more and items else None

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
    filename:    str     | None = Query(None, description="Case-insensitive substring match on filename"),
    account:     str     | None = Query(None, description="Case-insensitive substring match on account name"),
    after:       int     | None = Query(None, description="Cursor: last seen import ID"),
    limit:       int            = Query(50, ge=1, le=500),
    sort_by:     Literal["filename", "account", "imported_at", "row_count", "transaction_count"] = Query("imported_at"),
    sort_dir:    Literal["asc", "desc"] = Query("desc"),
    db: AsyncSession = Depends(get_db),
):
    txn_count_expr = (
        select(func.count(Transaction.id))
        .where(Transaction.csv_import_id == CsvImport.id)
        .correlate(CsvImport)
        .scalar_subquery()
    )
    account_name_expr = (
        select(Account.name)
        .where(Account.id == CsvImport.account_id)
        .correlate(CsvImport)
        .scalar_subquery()
    )
    sort_expr = {
        "filename":          CsvImport.filename,
        "account":           account_name_expr,
        "imported_at":       CsvImport.imported_at,
        "row_count":         CsvImport.row_count,
        "transaction_count": txn_count_expr,
    }[sort_by]

    if sort_dir == "desc":
        order_clauses = [sort_expr.desc().nulls_last(), CsvImport.id.desc()]
    else:
        order_clauses = [sort_expr.asc().nulls_last(), CsvImport.id.asc()]

    conditions = []
    if filename:
        conditions.append(CsvImport.filename.ilike(f"%{filename}%"))
    if account:
        conditions.append(account_name_expr.ilike(f"%{account}%"))

    if after is not None:
        cur = await db.get(CsvImport, after)
        if sort_by == "transaction_count":
            cursor_val = await db.scalar(
                select(func.count(Transaction.id)).where(Transaction.csv_import_id == after)
            )
        elif sort_by == "account":
            cursor_val = await db.scalar(
                select(Account.name).where(Account.id == cur.account_id)
            )
        else:
            cursor_val = getattr(cur, sort_by)  # filename, imported_at, row_count

        id_cmp = (CsvImport.id < after) if sort_dir == "desc" else (CsvImport.id > after)
        if cursor_val is None:
            conditions.append(and_(sort_expr.is_(None), id_cmp))
        else:
            beyond = (sort_expr < cursor_val) if sort_dir == "desc" else (sort_expr > cursor_val)
            tied   = and_(sort_expr == cursor_val, id_cmp)
            conditions.append(or_(beyond, tied, sort_expr.is_(None)))

    rows = (await db.execute(
        select(
            CsvImport.id,
            CsvImport.filename,
            CsvImport.imported_at,
            CsvImport.row_count,
            CsvImport.enriched_rows,
            CsvImport.status,
            account_name_expr.label("account"),
            txn_count_expr.label("transaction_count"),
        )
        .where(*conditions)
        .order_by(*order_clauses)
        .limit(limit + 1)
    )).all()

    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = items[-1].id if has_more and items else None

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
    csv_import = await db.get(CsvImport, import_id)
    if csv_import is None:
        raise HTTPException(status_code=404, detail="Import not found")
    return {
        "csv_import_id": csv_import.id,
        "row_count": csv_import.row_count,
        "enriched_rows": csv_import.enriched_rows,
        "complete": csv_import.enriched_rows >= csv_import.row_count,
    }


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

    column_mapping = detector.detect(reader.fieldnames, rows)

    if column_mapping["date"] is None or column_mapping["amount"] is None:
        raise HTTPException(status_code=422, detail="Could not detect date or amount columns")

    # Upsert Account by name
    result = await db.execute(select(Account).where(Account.name == account_name))
    account = result.scalar_one_or_none()
    if account is None:
        account = Account(name=account_name)
        db.add(account)
        await db.flush()

    if account_type is not None:
        account.account_type = account_type

    # Re-import check: find existing CsvImport by filename
    result = await db.execute(select(CsvImport).where(CsvImport.filename == file.filename))
    existing = result.scalar_one_or_none()
    if existing:
        await db.execute(delete(Transaction).where(Transaction.csv_import_id == existing.id))
        existing.account_id = account.id
        existing.imported_at = datetime.utcnow()
        existing.row_count = len(rows)
        existing.enriched_rows = 0
        existing.status = "in-progress"
        existing.column_mapping = json.dumps(column_mapping)
        csv_import = existing
    else:
        csv_import = CsvImport(
            account_id=account.id,
            filename=file.filename,
            row_count=len(rows),
            column_mapping=json.dumps(column_mapping),
            status="in-progress",
        )
        db.add(csv_import)
    await db.flush()

    # Resolve column indices to header names
    date_col = reader.fieldnames[column_mapping["date"]]
    amount_col = reader.fieldnames[column_mapping["amount"]]
    desc_col = reader.fieldnames[column_mapping["description"]] if column_mapping["description"] is not None else None

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
        enrich_input, rows, date_col, amount_col, desc_col,
        account.id, csv_import.id, account_type,
    )

    return {
        "csv_import_id": csv_import.id,
        "filename": file.filename,
        "rows_imported": len(rows),
        "columns": reader.fieldnames,
        "column_mapping": column_mapping,
        "status": "processing",
    }


@app.get("/transactions")
async def list_transactions(
    date_from:   date    | None = Query(None, description="Earliest date (YYYY-MM-DD), inclusive"),
    date_to:     date    | None = Query(None, description="Latest date (YYYY-MM-DD), inclusive"),
    merchant:    str     | None = Query(None, description="Case-insensitive substring match on merchant name"),
    description: str     | None = Query(None, description="Case-insensitive substring match on transaction description"),
    amount_min:  Decimal | None = Query(None, description="Minimum amount, inclusive"),
    amount_max:  Decimal | None = Query(None, description="Maximum amount, inclusive"),
    category:    str     | None = Query(None, description="Case-insensitive match on category name"),
    subcategory: str     | None = Query(None, description="Case-insensitive match on subcategory name"),
    account:     str     | None = Query(None, description="Case-insensitive substring match on account name"),
    import_id:    int     | None = Query(None, description="Filter to transactions from a specific CSV import"),
    is_recurring:  bool  | None = Query(None, description="Filter by recurring flag (true/false)"),
    uncategorized: bool  | None = Query(None, description="true = only transactions with no category/subcategory"),
    after:         int   | None = Query(None, description="Cursor: last seen transaction ID (from previous response's next_cursor)"),
    limit:       int            = Query(50, ge=1, le=500, description="Rows per page"),
    sort_by:     Literal["date", "amount", "description", "merchant", "category", "account"] = Query("date"),
    sort_dir:    Literal["asc", "desc"] = Query("desc"),
    db: AsyncSession = Depends(get_db),
):
    conditions = []
    if date_from:
        conditions.append(Transaction.date >= date_from)
    if date_to:
        conditions.append(Transaction.date <= date_to)
    if description:
        conditions.append(Transaction.description.ilike(f"%{description}%"))
    if amount_min is not None:
        conditions.append(Transaction.amount >= amount_min)
    if amount_max is not None:
        conditions.append(Transaction.amount <= amount_max)
    if merchant:
        merchant_ids = select(Merchant.id).where(Merchant.name.ilike(f"%{merchant}%"))
        conditions.append(Transaction.merchant_id.in_(merchant_ids))
    if category:
        cat_sub_ids = (
            select(Subcategory.id)
            .join(Category, Subcategory.category_id == Category.id)
            .where(Category.name.ilike(f"%{category}%"))
        )
        conditions.append(Transaction.subcategory_id.in_(cat_sub_ids))
    if subcategory:
        sub_ids = select(Subcategory.id).where(Subcategory.name.ilike(f"%{subcategory}%"))
        conditions.append(Transaction.subcategory_id.in_(sub_ids))
    if account:
        account_ids = select(Account.id).where(Account.name.ilike(f"%{account}%"))
        conditions.append(Transaction.account_id.in_(account_ids))
    if import_id is not None:
        conditions.append(Transaction.csv_import_id == import_id)
    if is_recurring is not None:
        conditions.append(Transaction.is_recurring == is_recurring)
    if uncategorized:
        conditions.append(Transaction.subcategory_id.is_(None))

    sort_expr = {
        "date":        Transaction.date,
        "amount":      Transaction.amount,
        "description": Transaction.description,
        "merchant":    select(Merchant.name)
                         .where(Merchant.id == Transaction.merchant_id)
                         .correlate(Transaction).scalar_subquery(),
        "category":    select(Category.name)
                         .where(Category.id ==
                             select(Subcategory.category_id)
                             .where(Subcategory.id == Transaction.subcategory_id)
                             .correlate(Transaction).scalar_subquery())
                         .correlate(Transaction).scalar_subquery(),
        "account":     select(Account.name)
                         .where(Account.id == Transaction.account_id)
                         .correlate(Transaction).scalar_subquery(),
    }[sort_by]

    if sort_dir == "desc":
        order_clauses = [sort_expr.desc().nulls_last(), Transaction.id.desc()]
    else:
        order_clauses = [sort_expr.asc().nulls_last(), Transaction.id.asc()]

    total_count = await db.scalar(
        select(func.count(Transaction.id)).where(*conditions)
    ) or 0

    if after is not None:
        cur = (await db.execute(
            select(Transaction).where(Transaction.id == after)
            .options(
                selectinload(Transaction.merchant),
                selectinload(Transaction.subcategory).selectinload(Subcategory.category),
                selectinload(Transaction.account),
            )
        )).scalar_one()

        cursor_val = {
            "date":        cur.date,
            "amount":      cur.amount,
            "description": cur.description,
            "merchant":    cur.merchant.name if cur.merchant else None,
            "category":    cur.subcategory.category.name if cur.subcategory else None,
            "account":     cur.account.name,
        }[sort_by]

        id_cmp = (Transaction.id < after) if sort_dir == "desc" else (Transaction.id > after)

        if cursor_val is None:
            conditions.append(and_(sort_expr.is_(None), id_cmp))
        else:
            beyond = (sort_expr < cursor_val) if sort_dir == "desc" else (sort_expr > cursor_val)
            tied   = and_(sort_expr == cursor_val, id_cmp)
            conditions.append(or_(beyond, tied, sort_expr.is_(None)))

    result = await db.execute(
        select(Transaction)
        .where(*conditions)
        .options(
            selectinload(Transaction.account),
            selectinload(Transaction.merchant),
            selectinload(Transaction.subcategory).selectinload(Subcategory.category),
        )
        .order_by(*order_clauses)
        .limit(limit + 1)
    )
    rows = result.scalars().all()

    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = items[-1].id if has_more and items else None

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
    merchant_name: str | None   # None = clear merchant
    category: str | None        # None = clear category/subcategory
    subcategory: str | None     # None = clear subcategory
    notes: str | None           # None = clear notes


@app.patch("/transactions/{transaction_id}")
async def update_transaction(
    transaction_id: int,
    body: TransactionUpdate,
    db: AsyncSession = Depends(get_db),
):
    tx = (await db.execute(
        select(Transaction)
        .where(Transaction.id == transaction_id)
        .options(
            selectinload(Transaction.account),
            selectinload(Transaction.merchant),
            selectinload(Transaction.subcategory).selectinload(Subcategory.category),
        )
    )).scalar_one_or_none()
    if tx is None:
        raise HTTPException(status_code=404, detail="Transaction not found")

    tx.description = body.description
    tx.notes = body.notes

    # Merchant
    if body.merchant_name and body.merchant_name.strip():
        merchant = (await db.execute(
            select(Merchant).where(Merchant.name.ilike(body.merchant_name.strip()))
        )).scalar_one_or_none()
        if merchant is None:
            merchant = Merchant(name=body.merchant_name.strip())
            db.add(merchant)
            await db.flush()
        tx.merchant_id = merchant.id
    else:
        tx.merchant_id = None

    # Category + Subcategory
    if body.category and body.category.strip() and body.subcategory and body.subcategory.strip():
        category = (await db.execute(
            select(Category).where(Category.name.ilike(body.category.strip()))
        )).scalar_one_or_none()
        if category is None:
            category = Category(name=body.category.strip())
            db.add(category)
            await db.flush()

        subcategory = (await db.execute(
            select(Subcategory).where(
                Subcategory.category_id == category.id,
                Subcategory.name.ilike(body.subcategory.strip()),
            )
        )).scalar_one_or_none()
        if subcategory is None:
            subcategory = Subcategory(category_id=category.id, name=body.subcategory.strip())
            db.add(subcategory)
            await db.flush()

        tx.subcategory_id = subcategory.id
    else:
        tx.subcategory_id = None

    await db.commit()
    await db.refresh(tx)

    # Reload relations after refresh
    tx = (await db.execute(
        select(Transaction)
        .where(Transaction.id == transaction_id)
        .options(
            selectinload(Transaction.account),
            selectinload(Transaction.merchant),
            selectinload(Transaction.subcategory).selectinload(Subcategory.category),
        )
    )).scalar_one()

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
    }


# ---------------------------------------------------------------------------
# AI: natural-language query → TransactionFilters
# ---------------------------------------------------------------------------

PARSE_QUERY_SYSTEM = """\
You are a personal finance query parser. Given a natural language query about transactions, \
extract filter criteria to pass to a transaction search API.

Today's date: {today}

Available filter fields:
- date_from, date_to: Date range (YYYY-MM-DD). Resolve relative terms ("last month", \
"last quarter", "this year", "January", etc.) using today's date.
- merchant: Substring match on merchant name (e.g. "Starbucks")
- description: Substring match on transaction description text
- category: Category name — must match one of the known categories listed below
- subcategory: Subcategory name — must match one of the known subcategories listed below
- account: Substring match on account name
- amount_min, amount_max: Amount bounds (numbers).
  IMPORTANT sign convention — expenses/debits are NEGATIVE, income/credits are POSITIVE:
    "expenses over $50"    → amount_max: -50  (i.e. more negative than −50)
    "spending under $20"   → amount_min: -20, amount_max: 0
    "income over $1000"    → amount_min: 1000
    "transactions over $0" → amount_min: 0
- is_recurring: Boolean. true = only recurring transactions, false = only non-recurring.
  Use for queries like "recurring", "subscriptions", "repeating charges", "non-recurring", etc.

Known categories and subcategories:
{categories}

Only set the fields clearly implied by the query. Leave all others unset (null).\
"""

PARSE_QUERY_TOOL_SCHEMA = {
    "type": "object",
    "properties": {
        "date_from":   {"type": ["string",  "null"], "description": "Start date YYYY-MM-DD, inclusive"},
        "date_to":     {"type": ["string",  "null"], "description": "End date YYYY-MM-DD, inclusive"},
        "merchant":    {"type": ["string",  "null"], "description": "Merchant name substring"},
        "description": {"type": ["string",  "null"], "description": "Transaction description substring"},
        "category":    {"type": ["string",  "null"], "description": "Category name (must be exact)"},
        "subcategory": {"type": ["string",  "null"], "description": "Subcategory name (must be exact)"},
        "account":     {"type": ["string",  "null"], "description": "Account name substring"},
        "amount_min":   {"type": ["number",  "null"], "description": "Minimum amount (negative = expense floor)"},
        "amount_max":   {"type": ["number",  "null"], "description": "Maximum amount (negative = expense ceiling)"},
        "is_recurring": {"type": ["boolean", "null"], "description": "true = recurring only, false = non-recurring only"},
        "explanation":  {"type": "string",            "description": "One-sentence summary of the applied filters"},
    },
    "required": ["explanation"],
}


class ParseQueryRequest(BaseModel):
    query: str


class QueryParser:
    def __init__(self):
        self.client = anthropic.Anthropic()

    def parse(self, query: str, categories_text: str) -> dict:
        today = date.today().isoformat()
        system = PARSE_QUERY_SYSTEM.format(today=today, categories=categories_text)
        message = self.client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=512,
            system=system,
            messages=[{"role": "user", "content": query}],
            tools=[{
                "name": "set_filters",
                "description": "Set transaction filter fields extracted from the natural language query",
                "input_schema": PARSE_QUERY_TOOL_SCHEMA,
            }],
            tool_choice={"type": "tool", "name": "set_filters"},
        )
        tool_use = next(b for b in message.content if b.type == "tool_use")
        return tool_use.input


query_parser = QueryParser()


@app.post("/ai/parse-query")
async def parse_query_endpoint(body: ParseQueryRequest, db: AsyncSession = Depends(get_db)):
    # Fetch all known categories and subcategories so Claude uses exact strings
    rows = (await db.execute(
        select(Category.name.label("cat"), Subcategory.name.label("sub"))
        .join(Subcategory, Subcategory.category_id == Category.id)
        .order_by(Category.name, Subcategory.name)
    )).all()

    # Build a human-readable list: "Food & Drink: Restaurants, Groceries, ..."
    cat_map: dict[str, list[str]] = defaultdict(list)
    for r in rows:
        cat_map[r.cat].append(r.sub)
    categories_text = "\n".join(
        f"- {cat}: {', '.join(subs)}" for cat, subs in sorted(cat_map.items())
    ) or "(no categories in database yet)"

    try:
        result = await asyncio.to_thread(query_parser.parse, body.query, categories_text)
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
