# Budget Tools

Personal finance app for importing, enriching, and analysing bank transactions.

## Stack

- **Backend**: Python 3.13, FastAPI (async), SQLAlchemy (async), SQLite via aiosqlite
- **AI**: Anthropic SDK — Claude used for CSV column detection, transaction enrichment, natural-language query parsing, and merchant deduplication
- **Frontend**: React 18, TypeScript, React Router 6, Tailwind CSS 4, Vite, Plotly.js

## Dev

```bash
./dev.sh          # launches tmux session: API on :8000, frontend on :5173
```

Requires a `.env` file (see `.env.example`) with `ANTHROPIC_API_KEY`.

Manually:
```bash
source venv/bin/activate && uvicorn budget.main:app --reload   # API
cd frontend && npm run dev                                      # frontend
```

Docker:
```bash
docker compose up --build   # API :8000, frontend :80
```

## Python

Always run Python and pytest through the virtualenv:

```bash
./venv/bin/python              # Python interpreter
./venv/bin/pytest              # run tests
```

Or activate first:

```bash
source venv/bin/activate
python ...
pytest ...
```

## Tests

```bash
nvm use node                  # select correct Node version first
./venv/bin/pytest                        # all tests
./venv/bin/pytest tests/test_api.py      # API endpoints (async, in-memory SQLite)
./venv/bin/pytest tests/test_queries.py  # query layer
./venv/bin/pytest tests/test_ai.py       # AI modules
```

Fixtures are in `tests/conftest.py`: `make_account`, `make_merchant`, `make_category`, `make_transaction`, plus an async `client` using `httpx.AsyncClient`.

## Code quality

Pre-commit hooks (run automatically on commit):

```bash
pre-commit run --all-files    # run manually
```

**Python hooks:** `trailing-whitespace`, `end-of-file-fixer`, `check-yaml`, `black`, `isort`, `mypy`, `flake8`.

Config: black line length 88; isort profile `black`; flake8 ignores E203/E501 (`.flake8`); isort profile in `pyproject.toml`.

**Frontend hooks:** `frontend-typecheck` (tsc --noEmit), `frontend-eslint` (ESLint 9 flat config), `frontend-prettier` (Prettier format check). All scoped to `frontend/src/`.

Frontend scripts (run individually from `frontend/`):

```bash
npm run typecheck       # tsc --noEmit
npm run lint            # ESLint
npm run lint:fix        # ESLint with auto-fix
npm run format          # Prettier (write)
npm run format:check    # Prettier (check only — used by pre-commit)
```

Config files: `frontend/eslint.config.js` (ESLint 9 flat config with typescript-eslint, react-hooks, react-refresh, prettier); `frontend/.prettierrc` (semi, double quotes, 2-space indent, trailing commas, printWidth 100).

## Architecture

### Backend layout

| File | Purpose |
|------|---------|
| `budget/models.py` | SQLAlchemy ORM models |
| `budget/database.py` | Engine, session factory, `get_db` dependency |
| `budget/query.py` | Data access layer — one class per domain |
| `budget/ai.py` | Claude integrations |
| `budget/main.py` | FastAPI routes and background tasks |

### Data model

```
Account → CsvImport → Transaction → Merchant
                              └──→ Subcategory → Category
```

- Amounts are `Decimal`; expenses are **negative**, income **positive**
- `Transaction.is_recurring` is set by Claude during enrichment
- `Subcategory` is the FK on Transaction; `Category` is reached via `subcategory.category`

### Query classes (`budget/query.py`)

All query classes take an `AsyncSession` and are instantiated per-request:

- `AnalyticsQueries` — recurring, monthly, overview, category breakdown
- `AccountQueries` — account CRUD + cursor pagination
- `CsvImportQueries` — import tracking and enrichment progress
- `MerchantQueries` — merchant CRUD, stats, merge, duplicate detection; pagination via `.paginate()` (not `.list()` — name was reserved due to a mypy conflict)
- `CategoryQueries` — category/subcategory lookup and creation
- `TransactionQueries` — flexible filtering + cursor pagination

Pagination is cursor-based (keyset) via `after_id`. All paginated methods return `(items, has_more, next_cursor)`.

### AI modules (`budget/ai.py`)

| Class | Claude model | Purpose |
|-------|-------------|---------|
| `ColumnDetector` | haiku-4-5 | Maps CSV columns → `{description, date, amount}` indices via tool use |
| `TransactionEnricher` | sonnet-4-6 | Batch-enriches transactions: merchant, category, subcategory, `is_recurring`, cleaned description |
| `QueryParser` | haiku-4-5 | Parses natural-language queries into filter params |
| `MerchantDuplicateFinder` | haiku-4-5 | Identifies groups of duplicate merchant names |

Enrichment runs in a `BackgroundTask`: batches of 50, up to 3 concurrent, with retry (3 attempts, exponential backoff).

### CSV import flow

1. `POST /import-csv` — detect columns (Claude), upsert Account + CsvImport, launch background task
2. Background task — enrich in batches, commit after each batch, update `enriched_rows`
3. `GET /imports/{id}/progress` — poll status

### Frontend layout

Pages in `frontend/src/pages/`. API calls via typed client in `frontend/src/api/client.ts` (base path `/api`). Routes defined in `App.tsx`.

## Known caveats

- SQLite is used; no migrations — schema changes are applied via `ALTER TABLE` in the FastAPI lifespan handler (`main.py`)
- `MerchantQueries.list` was renamed to `MerchantQueries.paginate` to avoid a mypy issue where a method named `list` shadows the `list` builtin in sibling method annotations within the same class
- `query.py` uses `from __future__ import annotations`. Any method inside a class that has a `list` method (e.g. `TransactionQueries`) must **not** use `list[T]` in annotations — use `Sequence[T]` from `collections.abc` instead, since `list[T]` resolves to the class method rather than the builtin under postponed evaluation
