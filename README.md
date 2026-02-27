# Budget

A personal finance app that imports bank/credit card CSVs, auto-categorizes transactions using Claude, and surfaces spending insights.

## Stack

- **Backend** — FastAPI, SQLAlchemy (async), SQLite, Anthropic SDK
- **Frontend** — React, React Router, Tailwind CSS, Vite

## Features

### Importing
- CSV import with automatic column detection — Claude maps your CSV columns to date, description, and amount
- Choose the account name, institution, and account type at import time
- AI-powered merchant enrichment and transaction categorization runs in the background after upload
- Real-time progress bar shows enrichment status (rows processed / total)
- Abort an in-progress enrichment job at any time
- Re-enrich an existing import to re-classify transactions with fresh AI output
- Import history with per-import status, row counts, and detected column mapping

### Transactions
- Paginated transaction list with sort and filter (date, amount, merchant, category, account, cardholder, recurring, uncategorized)
- Filter bar with autocomplete for merchant, category, subcategory, account, and cardholder fields
- Natural-language search — type a plain-English query (e.g. "coffee shops last month") and Claude translates it to filter parameters
- Click any row to view and edit transaction details inline: merchant, category, subcategory, description, notes, cardholder
  - Merchant field with live autocomplete backed by the API
  - Category and subcategory fields with client-side autocomplete from existing categories
  - Clearing a field removes the association from the transaction
  - Find-or-create: new merchant and category names are created automatically on save
- Bulk re-enrich: select multiple rows and send them back to Claude for fresh categorization
- Merchant logos shown next to merchant names (via logo.dev), falling back to an initial-letter avatar

### Overview
- Stat cards: total transactions, income, expenses, net change, and savings rate
- **Date filter bar** — scope every stat, chart, and table to a time window:
  - One-click presets: All time, Month to date, Year to date
  - Custom range: From / To month dropdowns (populated from your transaction history)
  - Filter state is stored in the URL so the browser back button restores it
- **Sankey diagram** — visualizes money flow from income sources through expense categories to savings; click any node to jump to its transactions
- **Spending donut** — proportional breakdown of spending by category; click any slice to jump to its transactions
- **Income by category table** — lists each income category with its total; click to view transactions
- **Expenses by category table** — lists each expense category with its total; click to view transactions
- **Budget alerts** — shown when viewing Month to date; highlights any budgets that are approaching or over their limit, with a direct link to the relevant transactions

### Budgets
- Set monthly spending limits scoped to a full category or a specific subcategory
- Progress bar and percentage on each budget card; severity badge (on track / approaching / over)
- Forecast: projects end-of-month spend at the current daily rate
- Need/Want badge on each card (set on the Categories page)
- Historical bar chart per budget showing the past 6 months of spending vs. the limit
- **Budget Wizard** — AI-assisted batch setup:
  - *Custom mode*: suggests budgets based on your own historical spending over a configurable look-back period
  - *50/30/20 mode*: allocates income using the 50/30/20 rule, driven by the Need/Want classification on each category
  - Review and edit every suggestion before batch-creating them

### Categories & Classification
- Spending breakdown by category and subcategory with donut charts and sortable tables
- Filter by date range, category, and subcategory
- **Need/Want classification** — tag each category or subcategory as a Need (essential) or Want (discretionary); used by the Budget Wizard's 50/30/20 mode
- Click any category or subcategory to jump to its transactions

### Monthly Reports
- Pick any month from the sidebar; the report updates instantly
- Stat cards: income, expenses, net, and savings rate for the selected month
- **Sunburst chart** — hierarchical spending visualization with categories on the inner ring and subcategories on the outer; click a segment to zoom in
- Nested category/subcategory table with totals; each row links to the Transactions page pre-filtered to that category and month

### Recurring Charges
- Automatically detected by Claude during enrichment
- Summary cards: monthly cost, quarterly cost, annual cost, and subscription count
- Category breakdown table showing aggregated recurring spend by category and subcategory
- Detail table: merchant (with logo), category, typical amount, frequency (weekly / monthly / quarterly / annual), monthly equivalent cost, occurrence count, last charge date, and estimated next charge date
- Overdue detection — estimated next charge dates that have passed are highlighted in red
- Click a merchant name to view all its transactions

### Category Trends
- Month-over-month line chart of spending per category
- Configure the date range with From/To month pickers; filter state is saved in the URL
- One line per category with hover tooltips showing exact monthly amounts

### Accounts
- Lists every bank account that has been imported with institution, type, transaction count, and total amount
- Filter by name, institution, or type; sort by any column
- Click an account name to open Transactions filtered to that account

### Merchants & Deduplication
- Merchant list with logo, name, location, transaction count, and total spend
- Edit a merchant's name, location, and website from the detail modal
- **Merge duplicates** — Claude scans all merchants and groups likely duplicates (e.g. "Starbucks" and "STARBUCKS #0423"); review each group, set a canonical name, and merge in one click

### Card Holders
- Tracks individual cardholders on shared accounts by card number (last 4 digits)
- Assign a friendly name to each card number
- Filter by name or card number; click to view that cardholder's transactions

## Setup

### Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key from [console.anthropic.com](https://console.anthropic.com) |
| `SECRET_KEY` | Yes | Secret for JWT signing — generate with `python -c "import secrets; print(secrets.token_hex(32))"` |
| `GOOGLE_CLIENT_ID` | No | Enables Google OAuth sign-in (see below) |

For the frontend, copy `frontend/.env.example` to `frontend/.env` (or set at build time):

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_GOOGLE_CLIENT_ID` | No | Same client ID as above — enables the Google button on the login page |
| `VITE_LOGODEV_TOKEN` | No | [logo.dev](https://logo.dev) token — enables merchant brand logos |

### Docker (recommended)

```bash
cp .env.example .env   # fill in API keys
docker compose up --build
```

The app runs at `http://localhost` (frontend) and `http://localhost:8000` (API). The database is stored in a named volume (`budget_data`) so it persists across restarts.

### Local development

#### Backend

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in API keys
uvicorn budget.main:app --reload
```

#### Frontend

```bash
cd frontend
npm install
npm run dev
```

The app runs at `http://localhost:5173` (proxied to the API at port 8000).

Other frontend scripts:

```bash
npm run typecheck     # TypeScript type check
npm run lint          # ESLint
npm run format        # Prettier auto-format
```

### Creating users

The app requires authentication. Create users with the seed script:

```bash
python scripts/seed_user.py --email you@example.com --name "Your Name" --password yourpassword
```

### Google OAuth (optional)

1. Create an **OAuth 2.0 Web Application** credential at [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Add `http://localhost:5173` (and your production domain) to **Authorised JavaScript origins**
3. Set `GOOGLE_CLIENT_ID` in `.env` and `VITE_GOOGLE_CLIENT_ID` in `frontend/.env`

A Google sign-in button will appear on the login page. First sign-in creates a new account; subsequent sign-ins reuse it. Existing email/password accounts are automatically linked on first Google sign-in.

## TODO

### AI-powered analysis

- [ ] **Spend insights / narrative** — monthly summary email or dashboard card: "your biggest change this month was dining up 40%, driven by 3 visits to Nobu"; year-over-year and seasonal pattern detection
- [ ] **Anomaly & alert detection** — flag unusual charges for a known merchant, first-time merchant appearances, duplicate transactions, and bill amount changes (e.g. subscription price increase)
- [ ] **Forecasting** — project end-of-month spend by category at current pace; cash flow forecast based on known recurring income and expenses
- [ ] **Savings opportunity detection** — identify unused subscriptions (no related transactions in 60+ days), redundant same-category services, and category-level benchmarking
- [ ] **Goal tracking** — "at this savings rate you'll reach $10k in 4 months"; scenario modeling ("if you cut dining by 30% you save $180/month")
- [ ] **Transaction cleanup** — surface likely miscategorizations for user confirmation; merge duplicate merchant names (AMZN, AMAZON.COM, AMZN MKTP → Amazon)
