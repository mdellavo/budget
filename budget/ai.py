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


ENRICHMENT_PROMPT = """\
You are a personal finance assistant. You will be given a list of bank transaction descriptions and must identify the merchant, spending category, and subcategory for each one.

Bank descriptions are often truncated, uppercased, and contain store numbers or location codes. Use your knowledge to resolve unfamiliar merchants.

Spending categories and subcategories to use (pick the best fit, suggest a subcategory if no matches exist):

Education & Childcare: Daycare, Tuition, Childcare,
Food & Drink: Restaurants, Groceries, Coffee & Tea, Fast Food, Bars & Alcohol, Delivery
Shopping: Online Shopping, Clothing, Electronics, Home & Garden, Department Stores
Transportation: Gas & Fuel, Rideshare, Parking, Public Transit, Auto Maintenance, Insurance, Parking
Entertainment: Streaming, Movies & Theater, Games, Events & Concerts
Health & Fitness: Gym, Medical, Pharmacy, Dental, Vision, Mental Health
Travel: Hotels, Flights, Car Rental, Vacation Packages
Bills & Utilities: Electricity, Gas, Internet, Phone, Insurance, Subscriptions
Income: Paycheck, Transfer In, Refund, Interest Income, Reimbursement
Personal Care: Hair & Beauty, Spa, Clothing Care
Home: Rent, Mortgage, Home Services, Furniture
Financial: Bank Fees, ATM, Investment, Loan Payment
Subscriptions & Services:
Loans & Debt:
Technology/Software:
Government & Fees:
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
- card_number: if the raw description contains "CARD XXXX" or "CARDXXXX" where XXXX is digits, extract those digits. Otherwise null.
  e.g. "POS PURCHASE CARD 1234 STARBUCKS" → "1234"
  e.g. "ACH DEBIT CARD5678 NETFLIX" → "5678"
  e.g. "STARBUCKS #4821" → null
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
                    "index": {"type": "integer"},
                    "merchant_name": {"type": ["string", "null"]},
                    "merchant_location": {"type": ["string", "null"]},
                    "is_recurring": {"type": "boolean"},
                    "description": {"type": "string"},
                    "category": {"type": ["string", "null"]},
                    "subcategory": {"type": ["string", "null"]},
                    "card_number": {"type": ["string", "null"]},
                },
                "required": [
                    "index",
                    "merchant_name",
                    "merchant_location",
                    "is_recurring",
                    "description",
                    "category",
                    "subcategory",
                    "card_number",
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
