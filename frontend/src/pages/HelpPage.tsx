export default function HelpPage() {
  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Help &amp; Documentation</h1>
      <p className="text-gray-500 mb-8">Reference guide for all features in Budget.</p>

      {/* Table of contents */}
      <nav className="mb-10 bg-gray-50 border border-gray-200 rounded-lg p-5">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Contents
        </h2>
        <ol className="space-y-1 text-sm text-indigo-600 list-decimal list-inside">
          <li>
            <a href="#overview" className="hover:underline">
              Overview
            </a>
          </li>
          <li>
            <a href="#budgets" className="hover:underline">
              Budgets
            </a>
          </li>
          <li>
            <a href="#transactions" className="hover:underline">
              Transactions
            </a>
          </li>
          <li>
            <a href="#accounts" className="hover:underline">
              Accounts
            </a>
          </li>
          <li>
            <a href="#merchants" className="hover:underline">
              Merchants &amp; Deduplication
            </a>
          </li>
          <li>
            <a href="#card-holders" className="hover:underline">
              Card Holders
            </a>
          </li>
          <li>
            <a href="#categories" className="hover:underline">
              Categories &amp; Classification
            </a>
          </li>
          <li>
            <a href="#imports" className="hover:underline">
              Importing Transactions
            </a>
          </li>
          <li>
            <a href="#recurring" className="hover:underline">
              Recurring Transactions
            </a>
          </li>
          <li>
            <a href="#monthly" className="hover:underline">
              Monthly Reports
            </a>
          </li>
          <li>
            <a href="#trends" className="hover:underline">
              Category Trends
            </a>
          </li>
        </ol>
      </nav>

      <div className="space-y-12">
        {/* Overview */}
        <section id="overview">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Overview</h2>
          <div className="prose prose-sm text-gray-600 space-y-2">
            <p>
              The Overview page gives you a snapshot of your finances across all accounts and time
              periods.
            </p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Stat cards</strong> — total income, total expenses, net (income minus
                expenses), and savings rate.
              </li>
              <li>
                <strong>Budget alerts</strong> — any active budgets that have exceeded their limit
                are highlighted here.
              </li>
              <li>
                <strong>Sankey diagram</strong> — a flow chart showing how money moves from income
                sources through expense categories into savings.
              </li>
              <li>
                <strong>Spending donut</strong> — a proportional breakdown of spending across top
                categories.
              </li>
            </ul>
          </div>
        </section>

        {/* Budgets */}
        <section id="budgets">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Budgets</h2>
          <div className="prose prose-sm text-gray-600 space-y-2">
            <p>Set monthly spending limits and track your progress against them.</p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Budget cards</strong> — each card shows the category or subcategory, the
                monthly limit, amount spent so far, a progress bar, and a severity badge (on track /
                warning / over budget).
              </li>
              <li>
                <strong>Add budget</strong> — create a budget scoped to a full category or a
                specific subcategory, and set the monthly limit.
              </li>
              <li>
                <strong>Budget Wizard</strong> — automatically generates budget suggestions. Choose
                between <em>Custom</em> mode (based on your own historical spending over a selected
                look-back period) or <em>50/30/20</em> mode (allocates income using the 50/30/20
                rule, driven by the Need/Want classification on each category). Suggestions can be
                reviewed and edited before batch creation.
              </li>
              <li>
                <strong>Need/Want badges</strong> — each budget card shows whether the category is
                classified as a Need or a Want (set on the Categories page).
              </li>
              <li>
                <strong>Historical chart</strong> — shows spending for that category over the past 6
                months alongside the budget limit.
              </li>
            </ul>
          </div>
        </section>

        {/* Transactions */}
        <section id="transactions">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Transactions</h2>
          <div className="prose prose-sm text-gray-600 space-y-2">
            <p>Browse, filter, edit, and re-enrich every transaction in the database.</p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Sorting</strong> — click any column header (Date, Description, Merchant,
                Category, Amount, Account) to sort ascending or descending.
              </li>
              <li>
                <strong>Filter panel</strong> — filter by date range, merchant, description, min/max
                amount, category, subcategory, account, recurring flag, and cardholder.
              </li>
              <li>
                <strong>Natural-language search</strong> — type a plain-English query (e.g. "coffee
                shops last month") and Claude will translate it into filter parameters
                automatically.
              </li>
              <li>
                <strong>Inline edit</strong> — click any transaction row to edit the merchant,
                category, subcategory, notes, and cardholder directly.
              </li>
              <li>
                <strong>Re-enrich</strong> — sends selected transactions back to Claude for fresh
                merchant/category detection.
              </li>
              <li>
                <strong>Bulk actions</strong> — select multiple rows to re-enrich or update
                categories in bulk.
              </li>
              <li>
                <strong>Load more</strong> — transactions are paginated; click "Load more" to fetch
                the next page.
              </li>
            </ul>
          </div>
        </section>

        {/* Accounts */}
        <section id="accounts">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Accounts</h2>
          <div className="prose prose-sm text-gray-600 space-y-2">
            <p>View all bank accounts that have been imported.</p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Account list</strong> — shows account name, institution, type (chequing,
                savings, credit, etc.), and the number of transactions imported.
              </li>
              <li>
                <strong>Filter &amp; sort</strong> — filter accounts by name, institution, or type;
                sort by any column.
              </li>
              <li>
                <strong>Drill down</strong> — click an account name to open Transactions filtered to
                that account.
              </li>
            </ul>
          </div>
        </section>

        {/* Merchants */}
        <section id="merchants">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">
            Merchants &amp; Deduplication
          </h2>
          <div className="prose prose-sm text-gray-600 space-y-2">
            <p>
              Merchants are detected and normalised by Claude during import. This page lets you view
              and edit them.
            </p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Merchant list</strong> — name, location, transaction count, and total spend.
                Click a row to open a detail modal.
              </li>
              <li>
                <strong>Edit</strong> — rename a merchant or change its location from the detail
                modal.
              </li>
              <li>
                <strong>Merge duplicates</strong> — Claude scans all merchants and returns groups of
                likely duplicates (e.g. "Starbucks" and "STARBUCKS #123"). For each group you can
                set a canonical name and merge, or skip the group. Merchants with the same name but
                different locations are kept separate.
              </li>
            </ul>
          </div>
        </section>

        {/* Card Holders */}
        <section id="card-holders">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Card Holders</h2>
          <div className="prose prose-sm text-gray-600 space-y-2">
            <p>Track multiple cardholders on shared accounts.</p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Cardholder list</strong> — shows each cardholder by name and the last 4
                digits of their card number, along with transaction count and total spend.
              </li>
              <li>
                <strong>Filter</strong> — filter by last 4 digits or cardholder name.
              </li>
              <li>
                <strong>Edit label</strong> — assign a friendly name to a card number.
              </li>
              <li>
                <strong>Drill down</strong> — click a cardholder to view their transactions in the
                Transactions page.
              </li>
            </ul>
          </div>
        </section>

        {/* Categories */}
        <section id="categories">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">
            Categories &amp; Classification
          </h2>
          <div className="prose prose-sm text-gray-600 space-y-2">
            <p>Browse spending by category and subcategory, and set Need/Want classifications.</p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Date filter</strong> — narrow the breakdown to a custom date range.
              </li>
              <li>
                <strong>Need/Want toggle</strong> — each category and subcategory can be classified
                as a <em>Need</em> (essential spending) or a <em>Want</em> (discretionary). This
                classification is used by the Budget Wizard's 50/30/20 mode.
              </li>
              <li>
                <strong>Donut charts</strong> — each category has a donut chart showing
                subcategory-level proportions.
              </li>
              <li>
                <strong>Drill down</strong> — click a category or subcategory to see its
                transactions.
              </li>
            </ul>
          </div>
        </section>

        {/* Imports */}
        <section id="imports">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Importing Transactions</h2>
          <div className="prose prose-sm text-gray-600 space-y-2">
            <p>Import transactions from a CSV file exported from your bank.</p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Upload CSV</strong> — provide the account name, account type, and choose
                your CSV file. Claude automatically detects which columns map to date, description,
                and amount.
              </li>
              <li>
                <strong>Background enrichment</strong> — after import, Claude processes transactions
                in batches to assign merchants, categories, subcategories, and recurring flags. A
                progress bar shows completion.
              </li>
              <li>
                <strong>Re-enrich</strong> — run enrichment again on an existing import if you want
                Claude to re-classify transactions (e.g. after updating merchant or category data).
              </li>
              <li>
                <strong>Abort</strong> — cancel an in-progress enrichment job.
              </li>
              <li>
                <strong>Import history</strong> — all previous imports are listed with their status,
                row count, and date.
              </li>
            </ul>
          </div>
        </section>

        {/* Recurring */}
        <section id="recurring">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Recurring Transactions</h2>
          <div className="prose prose-sm text-gray-600 space-y-2">
            <p>
              Claude automatically detects recurring charges (subscriptions, bills, etc.) during
              enrichment.
            </p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Frequency</strong> — each recurring item shows how often it charges (weekly,
                monthly, quarterly, etc.).
              </li>
              <li>
                <strong>Monthly cost</strong> — normalized to a monthly equivalent for easy
                comparison.
              </li>
              <li>
                <strong>Next expected date</strong> — predicted next charge based on the detected
                frequency.
              </li>
              <li>
                <strong>Overdue</strong> — items past their expected date are highlighted so you can
                check whether the charge appeared.
              </li>
            </ul>
          </div>
        </section>

        {/* Monthly */}
        <section id="monthly">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Monthly Reports</h2>
          <div className="prose prose-sm text-gray-600 space-y-2">
            <p>Detailed breakdown of income and spending for a single calendar month.</p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Month selector</strong> — pick any month from the sidebar; the report
                updates instantly.
              </li>
              <li>
                <strong>Stat cards</strong> — income, expenses, net, and savings rate for the
                selected month.
              </li>
              <li>
                <strong>Sunburst chart</strong> — interactive chart with categories on the inner
                ring and subcategories on the outer ring. Click a segment to zoom in.
              </li>
              <li>
                <strong>Nested table</strong> — categories and subcategories with totals, each
                linking to the Transactions page pre-filtered to that category and month.
              </li>
            </ul>
          </div>
        </section>

        {/* Trends */}
        <section id="trends">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Category Trends</h2>
          <div className="prose prose-sm text-gray-600 space-y-2">
            <p>Visualise how spending in each category changes over time.</p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Date range</strong> — choose a start and end month to define the window.
              </li>
              <li>
                <strong>Multi-line chart</strong> — one line per category, showing monthly totals
                over the selected range.
              </li>
              <li>
                <strong>Spot trends</strong> — useful for identifying categories where spending is
                growing or shrinking over time.
              </li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
