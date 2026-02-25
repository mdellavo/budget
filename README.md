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
- Re-enrich individual transactions or an entire import at any time

### Transactions
- Paginated transaction list with sort and filter (date, amount, merchant, category, account, cardholder, recurring, uncategorized)
- Filter bar autocomplete for merchant, category, subcategory, account, and cardholder fields
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
- Trends — month-over-month expense line chart by category with configurable date range (URL-persisted)

### Management
- Account, merchant, category, cardholder, and import management pages
- AI-powered duplicate merchant detection and bulk merge
- Cursor-based pagination throughout for consistent performance on large datasets

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
- [ ] **Merchant logos**
