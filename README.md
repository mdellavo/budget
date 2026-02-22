# Budget

A personal finance app that imports bank/credit card CSVs, auto-categorizes transactions using Claude, and surfaces spending insights.

## Stack

- **Backend** — FastAPI, SQLAlchemy (async), SQLite, Anthropic SDK
- **Frontend** — React, React Router, Tailwind CSS, Vite

## Features

- CSV import with automatic column detection
- AI-powered merchant enrichment and transaction categorization
- Recurring charge detection
- Spending overview with Sankey chart and category breakdown
- Account, merchant, transaction, and import management

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

## TODO

### AI-powered analysis

- merchant logos

- [ ] **Spend insights / narrative** — monthly summary email or dashboard card: "your biggest change this month was dining up 40%, driven by 3 visits to Nobu"; year-over-year and seasonal pattern detection
- [ ] **Anomaly & alert detection** — flag unusual charges for a known merchant, first-time merchant appearances, duplicate transactions, and bill amount changes (e.g. subscription price increase)
- [ ] **Forecasting** — project end-of-month spend by category at current pace; cash flow forecast based on known recurring income and expenses
- [ ] **Savings opportunity detection** — identify unused subscriptions (no related transactions in 60+ days), redundant same-category services, and category-level benchmarking
- [ ] **Goal tracking** — "at this savings rate you'll reach $10k in 4 months"; scenario modeling ("if you cut dining by 30% you save $180/month")
- [ ] **Transaction cleanup** — surface likely miscategorizations for user confirmation; merge duplicate merchant names (AMZN, AMAZON.COM, AMZN MKTP → Amazon)
