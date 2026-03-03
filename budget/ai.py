import csv
import io
import logging
import time
from datetime import date
from typing import Any

import anthropic

logger = logging.getLogger(__name__)

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
        "description": {
            "type": ["integer", "null"],
            "description": "Zero-based index of the column containing the transaction description or memo",
        },
        "date": {
            "type": ["integer", "null"],
            "description": "Zero-based index of the column containing the transaction date",
        },
        "amount": {
            "type": ["integer", "null"],
            "description": "Zero-based index of the column containing the transaction amount",
        },
    },
    "required": ["description", "date", "amount"],
}


class ColumnDetector:
    def __init__(self):
        self.client = anthropic.Anthropic()

    def _build_csv_sample(self, fieldnames: list[str], rows: list[dict]) -> str:
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows[:SAMPLE_ROWS])
        return output.getvalue()

    def detect(self, fieldnames: list[str], rows: list[dict]) -> dict[str, int | None]:
        csv_sample = self._build_csv_sample(fieldnames, rows)
        prompt = PROMPT_TEMPLATE.format(csv_sample=csv_sample)

        message = self.client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=256,
            messages=[{"role": "user", "content": prompt}],
            tools=[
                {
                    "name": "map_columns",
                    "description": "Map CSV columns to known target columns by their zero-based index",
                    "input_schema": COLUMN_MAPPING_SCHEMA,
                }
            ],
            tool_choice={"type": "tool", "name": "map_columns"},
        )

        tool_use = next(block for block in message.content if block.type == "tool_use")
        mapping = tool_use.input

        return {col: mapping.get(col) for col in KNOWN_COLUMNS}


detector = ColumnDetector()


ENRICHMENT_SYSTEM = """\
You are a personal finance assistant. You will be given a list of bank transaction descriptions \
and must identify the merchant, spending category, and subcategory for each one.

Bank descriptions are often truncated, uppercased, and contain store numbers or location codes. \
Use your knowledge to resolve unfamiliar merchants.

Spending categories and subcategories to use (pick the best fit, suggest a new subcategory if needed):

Food & Drink: Groceries, Restaurants, Fast Food, Coffee & Tea, Bars & Alcohol, Food Delivery
Shopping: Clothing, Electronics, Home & Garden, Online Shopping, Department Stores
Transportation: Gas & Fuel, Auto Maintenance, Auto Insurance, Rideshare, Public Transit, Parking
Bills & Utilities: Electricity, Gas, Water, Internet, Phone, Cable/Satellite
Subscriptions & Services: Streaming, Software & Apps, Memberships, Newspapers & Magazines
Health & Fitness: Medical, Dental, Vision, Pharmacy, Mental Health, Gym & Fitness
Personal Care: Hair & Beauty, Spa & Massage, Laundry & Dry Cleaning
Home: Rent, Mortgage, Furniture & Decor, Home Services & Repairs, Home Insurance
Education & Childcare: Tuition & Fees, Daycare & Childcare, School Supplies, Student Loans
Entertainment: Movies & Theater, Events & Concerts, Games, Hobbies
Travel: Flights, Hotels & Lodging, Car Rental, Vacation Packages, Travel Insurance
Loans & Debt: Personal Loan, Auto Loan, Medical Debt
Financial: Bank Fees, ATM Fees, Investment & Brokerage, Taxes, Wire & Transfer Fees
Cash & ATM: ATM Withdrawal
Government & Fees: Taxes, DMV & Registration, Fines & Penalties, Postage & Shipping
Giving: Charitable Donations, Gifts, Religious & Tithing
Income: Paycheck, Freelance & Side Income, Reimbursement, Refund, Interest & Dividends
Transfer: Credit Card Payment, Internal Transfer, Investment Contribution, Investment Withdrawal
Other: Anything that doesn't fit the above categories\
"""

ENRICHMENT_PROMPT = """\
Transfers (excluded from income/expense totals — use for money moving between your own accounts):
- Payment FROM a bank account TO a credit card → Transfer / Credit Card Payment
  e.g. "AUTOPAY PAYMENT", "CHASE CREDIT CRD AUTOPAY", "ONLINE PAYMENT THANK YOU"
- Credit received ON a credit card from a payment → Transfer / Credit Card Payment
  e.g. "PAYMENT THANK YOU", "MOBILE PAYMENT - THANK YOU"
- Bank-to-bank or checking-to-savings moves → Transfer / Internal Transfer
  e.g. "TRANSFER TO SAVINGS", "ZELLE TRANSFER TO", "ACH TRANSFER"
- Brokerage contributions/withdrawals → Transfer / Investment Contribution or Withdrawal
  e.g. "FIDELITY CONTRIBUTION", "VANGUARD TRANSFER IN"

P2P payments (Venmo, Zelle, CashApp, PayPal, Apple Pay Cash):
- Sending money to a person → Transfer / Internal Transfer; payment_channel = "p2p"
  e.g. "VENMO PAYMENT TO JANE DOE", "ZELLE TO JOHN SMITH"
- Receiving money from a person → Income / Reimbursement; payment_channel = "p2p"
  e.g. "VENMO TRANSFER FROM JOHN", "ZELLE FROM SARAH"
- Payment to a business via P2P platform → treat as merchant purchase; payment_channel = "purchase"
  e.g. "PAYPAL *SHOPIFY STORE", "VENMO *ACME RESTAURANT"

Refunds & credits:
- If the description contains "REFUND", "RETURN", "CREDIT", "REVERSAL", "ADJUSTMENT",
  or "CHARGEBACK" from a recognizable merchant, categorize under that merchant's original
  category (not Income). Set is_refund = true and payment_channel = "refund".
  e.g. "AMAZON REFUND" → Shopping / Online Shopping, is_refund=true
  e.g. "UBER TRIP CREDIT" → Transportation / Rideshare, is_refund=true
  e.g. "HOTEL CANCELLATION REFUND" → Travel / Hotels & Lodging, is_refund=true
- Only use Income / Refund for vague credits with no identifiable merchant category.

Seasonal date signals (soft hints — don't override clear description evidence):
- November–December transactions at retailers → consider Giving / Gifts
- April transactions to "IRS", "STATE TAX", "FRANCHISE TAX" → Government & Fees / Taxes
- Annual subscription charges on a recurring date → is_recurring = true

Rules:
- merchant_name: canonical business name, Title Case, no location codes or store numbers
  e.g. "STARBUCKS #4821 SEATTLE WA" → "Starbucks"
  e.g. "AMZN MKTP US*1A2B3" → "Amazon"
- is_recurring: true if (a) description explicitly contains "recurring", "subscription",
  "membership", "autopay", "auto pay", "autorenew", "auto renew", "annual renewal",
  "monthly", "yearly", "renew", "renewal", "auto-pay", "autorenew"; OR (b) the merchant
  is clearly a subscription or regularly-recurring service (streaming, SaaS, rent, gym,
  insurance, utilities, loan payments). false for one-off purchases.
  e.g. "RECURRING PAYMENT GEICO" → true, "NETFLIX.COM" → true, "GITHUB" → true
  e.g. "STARBUCKS #4821" → false, "UBER TRIP" → false
- is_refund: true if this is a refund, return, credit, or reversal (see Refunds above).
- is_international: true if the description contains a non-US country name, international
  city, "INTL", "FOREIGN", "FX", or a non-US currency code (GBP, EUR, CAD, AUD, JPY, etc.).
  e.g. "AIRBNB * LISBON PT" → true, "REVOLUT* LONDON GB" → true, "FOREIGN TRANSACTION FEE" → true
  e.g. "STARBUCKS SEATTLE WA" → false
- payment_channel: how money moved:
    "purchase"  — normal card/ACH purchase at a merchant
    "refund"    — credit back from a merchant (set is_refund=true too)
    "fee"       — bank or service fee (overdraft, wire fee, late fee, ATM fee)
    "interest"  — interest charge or dividend/interest income
    "p2p"       — Venmo/Zelle/CashApp/PayPal/Apple Pay Cash person-to-person
    "atm"       — cash ATM withdrawal (not an ATM fee)
    "transfer"  — account-to-account, credit card payment, brokerage contribution
    "payroll"   — direct deposit / paycheck / employer payment
- merchant_location: extract from raw description only if explicitly present.
  Format "City, ST" for US, "City, Country" for international. Null if not in text.
  e.g. "STARBUCKS #4821 SEATTLE WA" → "Seattle, WA"; "AMZN MKTP US*1A2B3" → null
- card_number: if raw description contains "CARD XXXX" or "CARDXXXX" extract those digits, else null.
- merchant_website: bare primary domain (e.g. "netflix.com"). No https:// or www. Null if unknown.
- description: short human-readable summary, Title Case. Strip store numbers, IDs, location codes.
  e.g. "STARBUCKS #4821 SEATTLE WA" → "Starbucks Coffee"
- suggested_tags: 0–3 short lowercase tags relevant to this specific transaction.
  Only suggest when clearly applicable. Good tags: "work-expense", "tax-deductible",
  "reimbursable", "home-office", "travel", "health", "gift", "subscription", "cash".
  Empty array if nothing clearly applies.
- ATM withdrawals vs fees: "WITHDRAWAL"/"CASH WITHDRAWAL" → Cash & ATM / ATM Withdrawal.
  "FEE"/"CHARGE"/"TRANSACTION FEE" for ATM → Financial / ATM Fees.
- Positive amounts are typically income/credits; negative amounts are expenses.
- If a merchant cannot be identified, set merchant_name to null.
- subcategory must be one of the values listed under the chosen category.
- need_want: "need" (essential) or "want" (discretionary) at the subcategory level.
  Needs: groceries, utilities, rent/mortgage, healthcare, insurance, loan repayments, education,
  childcare, commuting. Wants: dining out, food delivery, entertainment, travel, shopping,
  hobbies, streaming, personal luxuries. When ambiguous, lean toward "need".
- Return a result for every transaction index — do not skip any.

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
                    "index": {"type": "integer"},
                    "merchant_name": {"type": ["string", "null"]},
                    "merchant_location": {"type": ["string", "null"]},
                    "merchant_website": {"type": ["string", "null"]},
                    "is_recurring": {"type": "boolean"},
                    "is_refund": {"type": "boolean"},
                    "is_international": {"type": "boolean"},
                    "payment_channel": {
                        "type": "string",
                        "enum": [
                            "purchase",
                            "refund",
                            "fee",
                            "interest",
                            "p2p",
                            "atm",
                            "transfer",
                            "payroll",
                        ],
                    },
                    "suggested_tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "0-3 short lowercase tags. Empty array if none apply.",
                    },
                    "description": {"type": "string"},
                    "category": {"type": ["string", "null"]},
                    "subcategory": {"type": ["string", "null"]},
                    "card_number": {"type": ["string", "null"]},
                    "need_want": {
                        "type": "string",
                        "enum": ["need", "want"],
                        "description": (
                            "Whether this specific subcategory is a need (essential) or a want (discretionary). "
                            "Classify at the subcategory level, not the parent category. "
                            "e.g. under Food & Drink: Groceries → need, Food Delivery → want, Restaurants → want. "
                            "Needs: groceries, utilities, rent/mortgage, healthcare, insurance, loan repayments, "
                            "education, childcare, commuting. "
                            "Wants: dining out, food delivery, entertainment, travel, shopping, hobbies, "
                            "streaming services, personal luxuries. When genuinely ambiguous, lean toward 'need'."
                        ),
                    },
                },
                "required": [
                    "index",
                    "merchant_name",
                    "merchant_location",
                    "merchant_website",
                    "is_recurring",
                    "is_refund",
                    "is_international",
                    "payment_channel",
                    "suggested_tags",
                    "description",
                    "category",
                    "subcategory",
                    "card_number",
                    "need_want",
                ],
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
            batch_num,
            len(batch),
            batch[0]["index"],
            batch[-1]["index"],
        )
        tx_text = "\n".join(
            f"{r['index']}. [{r['date']}] {r['description']}  (amount: {r['amount']})"
            for r in batch
        )
        prompt = ENRICHMENT_PROMPT.format(transactions=tx_text)
        messages: list[dict[str, Any]] = [{"role": "user", "content": prompt}]
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
                max_tokens=16384,
                system=ENRICHMENT_SYSTEM,
                tools=tools,
                tool_choice={"type": "any"},
                messages=messages,
            )

            # Done — extract structured result
            for block in response.content:
                if block.type == "tool_use" and block.name == "enrich_transactions":
                    results = block.input.get("results")
                    if results is None:
                        raise RuntimeError(
                            f"enrich_transactions tool input missing 'results' key: {block.input}"
                        )
                    elapsed = time.perf_counter() - start
                    logger.info(
                        "Enrichment batch %d complete in %.2fs", batch_num, elapsed
                    )
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
        "date_from": {
            "type": ["string", "null"],
            "description": "Start date YYYY-MM-DD, inclusive",
        },
        "date_to": {
            "type": ["string", "null"],
            "description": "End date YYYY-MM-DD, inclusive",
        },
        "merchant": {
            "type": ["string", "null"],
            "description": "Merchant name substring",
        },
        "description": {
            "type": ["string", "null"],
            "description": "Transaction description substring",
        },
        "category": {
            "type": ["string", "null"],
            "description": "Category name (must be exact)",
        },
        "subcategory": {
            "type": ["string", "null"],
            "description": "Subcategory name (must be exact)",
        },
        "account": {
            "type": ["string", "null"],
            "description": "Account name substring",
        },
        "amount_min": {
            "type": ["number", "null"],
            "description": "Minimum amount (negative = expense floor)",
        },
        "amount_max": {
            "type": ["number", "null"],
            "description": "Maximum amount (negative = expense ceiling)",
        },
        "is_recurring": {
            "type": ["boolean", "null"],
            "description": "true = recurring only, false = non-recurring only",
        },
        "explanation": {
            "type": "string",
            "description": "One-sentence summary of the applied filters",
        },
    },
    "required": ["explanation"],
}


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
            tools=[
                {
                    "name": "set_filters",
                    "description": "Set transaction filter fields extracted from the natural language query",
                    "input_schema": PARSE_QUERY_TOOL_SCHEMA,
                }
            ],
            tool_choice={"type": "tool", "name": "set_filters"},
        )
        tool_use = next(b for b in message.content if b.type == "tool_use")
        return tool_use.input


query_parser = QueryParser()


FIND_DUPLICATES_SCHEMA = {
    "type": "object",
    "properties": {
        "groups": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "canonical_name": {"type": "string"},
                    "canonical_location": {"type": ["string", "null"]},
                    "member_ids": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "IDs of all merchants in this group (2 or more)",
                    },
                },
                "required": ["canonical_name", "canonical_location", "member_ids"],
            },
        }
    },
    "required": ["groups"],
}

FIND_DUPLICATES_SYSTEM = """\
You are a merchant deduplication assistant. Given a list of merchants from a personal finance app, \
identify groups of merchants that are likely the same business (e.g. "AMZN", "AMAZON.COM", "AMZN MKTP US" are all Amazon).

Rules:
- Only group merchants that are clearly the same business
- Each group must have 2 or more merchants
- Merchants with the same name but different non-null locations are different merchants and must NOT be grouped together
- Merchants with a null location can be grouped with other null-location merchants of the same business
- Suggest a clean canonical_name (Title Case, no store numbers or noise)
- canonical_location should be null unless all members share the same location
- Do not create singleton groups
"""


class MerchantDuplicateFinder:
    def __init__(self):
        self.client = anthropic.Anthropic()

    def find(self, merchants_text: str) -> dict:
        message = self.client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=4096,
            system=FIND_DUPLICATES_SYSTEM,
            messages=[{"role": "user", "content": merchants_text}],
            tools=[
                {
                    "name": "report_duplicate_groups",
                    "description": "Report groups of likely-duplicate merchants",
                    "input_schema": FIND_DUPLICATES_SCHEMA,
                }
            ],
            tool_choice={"type": "tool", "name": "report_duplicate_groups"},
        )
        tool_use = next(b for b in message.content if b.type == "tool_use")
        return tool_use.input


merchant_duplicate_finder = MerchantDuplicateFinder()


SUMMARIZE_SYSTEM = """\
You are a personal finance analyst. You will receive structured financial data \
for a specific time period and write a concise summary to help the user understand \
their finances. Be specific, reference actual numbers, and keep recommendations \
actionable. Avoid generic platitudes.

Use light markdown formatting in your response:
- Use **bold** to highlight key figures, dollar amounts, and important terms
- Use *italics* sparingly for emphasis
- Write naturally — avoid excessive formatting or nested structure\
"""

SUMMARIZE_INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "narrative": {
            "type": "string",
            "description": "2-3 sentence plain-English overview of the period. Use **bold** for key figures and dollar amounts.",
        },
        "insights": {
            "type": "array",
            "items": {"type": "string"},
            "description": "3-5 specific observations about spending, income, or trends. Each item may use **bold** for emphasis.",
        },
        "recommendations": {
            "type": "array",
            "items": {"type": "string"},
            "description": "2-3 concise, actionable financial recommendations. Each item may use **bold** for emphasis.",
        },
    },
    "required": ["narrative", "insights", "recommendations"],
}


class ReportSummarizer:
    model = "claude-haiku-4-5-20251001"

    def summarize(self, period_label: str, report_data: dict) -> dict:
        """
        period_label: human-readable string e.g. "February 2026" or "2025"
        report_data:  the full monthly/yearly report dict (summary + category_breakdown)
        Returns: { narrative, insights, recommendations }
        """
        import json

        client = anthropic.Anthropic()
        user_content = (
            f"Period: {period_label}\n\n"
            f"Financial data:\n{json.dumps(report_data, indent=2)}"
        )
        response = client.messages.create(  # type: ignore[call-overload]
            model=self.model,
            max_tokens=1024,
            system=SUMMARIZE_SYSTEM,
            tools=[
                {
                    "name": "write_summary",
                    "description": "Write a financial summary with insights and recommendations",
                    "input_schema": SUMMARIZE_INPUT_SCHEMA,
                }
            ],
            tool_choice={"type": "any"},
            messages=[{"role": "user", "content": user_content}],
        )
        for block in response.content:
            if block.type == "tool_use" and block.name == "write_summary":
                return block.input
        raise ValueError("No tool use block returned from Claude")


report_summarizer = ReportSummarizer()
