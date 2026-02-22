# Budget

A personal finance app that imports bank/credit card CSVs, auto-categorizes transactions using Claude, and surfaces spending insights.

## Stack

- **Backend** — FastAPI, SQLAlchemy (async), SQLite, Anthropic SDK
- **Frontend** — React, React Router, Tailwind CSS, Vite

## Features

### Importing
- CSV import with automatic column detection
- AI-powered merchant enrichment and transaction categorization on import
- Import history with per-import enrichment progress tracking

### Transactions
- Paginated transaction list with sort and filter (date, amount, merchant, category, account, recurring, uncategorized)
- Natural language search — type a plain-English query and Claude translates it to filters
- Click any row to view full transaction details in a modal (date, amount, merchant, category, subcategory, notes, recurring flag)
- Inline transaction editing — update description, merchant, category, subcategory, and notes without leaving the page
  - Merchant field with live autocomplete backed by the API
  - Category and subcategory fields with client-side autocomplete from existing categories
  - Clearing a field removes the association (merchant / category) from the transaction
  - Find-or-create: new merchant and category names are created automatically on save

### Insights
- Spending overview with income/expense summary and Sankey chart
- Category breakdown across any time period
- Monthly report view with per-category and per-subcategory totals
- Recurring charge detection with estimated next charge dates and monthly cost

### Management
- Account, merchant, category, and import management pages
- Cursor-based pagination throughout for consistent performance on large datasets

## Setup

### Docker (recommended)

```bash
export ANTHROPIC_API_KEY=sk-...
docker compose up --build
```

The app runs at `http://localhost` (frontend) and `http://localhost:8000` (API). The database is stored in a named volume (`budget_data`) so it persists across restarts.

### Local development

#### Backend

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-...
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

## TODO

### AI-powered analysis

- extract card number and card holder name
- spinner on sidebar if active imports running

- [ ] **Spend insights / narrative** — monthly summary email or dashboard card: "your biggest change this month was dining up 40%, driven by 3 visits to Nobu"; year-over-year and seasonal pattern detection
- [ ] **Anomaly & alert detection** — flag unusual charges for a known merchant, first-time merchant appearances, duplicate transactions, and bill amount changes (e.g. subscription price increase)
- [ ] **Forecasting** — project end-of-month spend by category at current pace; cash flow forecast based on known recurring income and expenses
- [ ] **Savings opportunity detection** — identify unused subscriptions (no related transactions in 60+ days), redundant same-category services, and category-level benchmarking
- [ ] **Goal tracking** — "at this savings rate you'll reach $10k in 4 months"; scenario modeling ("if you cut dining by 30% you save $180/month")
- [ ] **Transaction cleanup** — surface likely miscategorizations for user confirmation; merge duplicate merchant names (AMZN, AMAZON.COM, AMZN MKTP → Amazon)
- [ ] **Merchant logos**
