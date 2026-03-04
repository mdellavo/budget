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
            <a href="#categories" className="hover:underline">
              Categories &amp; Classification
            </a>
          </li>
          <li>
            <a href="#monthly" className="hover:underline">
              Monthly Reports
            </a>
          </li>
          <li>
            <a href="#yearly" className="hover:underline">
              Yearly Reports
            </a>
          </li>
          <li>
            <a href="#recurring" className="hover:underline">
              Recurring Charges
            </a>
          </li>
          <li>
            <a href="#trends" className="hover:underline">
              Category Trends
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
            <a href="#imports" className="hover:underline">
              Importing Transactions
            </a>
          </li>
          <li>
            <a href="#duplicates" className="hover:underline">
              Duplicate Transactions
            </a>
          </li>
          <li>
            <a href="#tags" className="hover:underline">
              Tags
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
              A high-level snapshot of your income, expenses, and savings. Every number, chart, and
              table on this page reflects the selected date window.
            </p>
            <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">Date filter</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>All time / Month to date / Year to date</strong> — one-click presets that
                instantly scope all stats, charts, and tables to the chosen window. Year to date is
                selected by default on first visit.
              </li>
              <li>
                <strong>From / To dropdowns</strong> — pick any start and end month for a custom
                range. Selecting a custom range deselects the active preset.
              </li>
              <li>
                The selected filter is stored in the URL, so the browser back button restores it
                after navigating away. Clearing the URL params resets to Year to date.
              </li>
            </ul>
            <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">Stat cards</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Total Transactions</strong>, <strong>Income</strong>,{" "}
                <strong>Expenses</strong>, <strong>Net Change</strong>, and{" "}
                <strong>Savings Rate</strong> — all scoped to the selected date window.
              </li>
            </ul>
            <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">Budget alerts</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                Shown only when the <em>Month to date</em> preset is active. Lists any budgets that
                are approaching or over their monthly limit, with a direct link to the relevant
                transactions.
              </li>
            </ul>
            <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">Money Flow (Sankey)</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                Flows from income sources on the left, through the total income pool in the middle,
                to expense categories and savings on the right. Band width is proportional to dollar
                amount.
              </li>
              <li>
                <strong>Click any node</strong> to jump to Transactions filtered to that income
                source or expense category.
              </li>
              <li>Hover over any band or node to see exact amounts and percentages.</li>
            </ul>
            <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">
              Spending by Category (donut)
            </h3>
            <ul className="list-disc list-inside space-y-1">
              <li>Proportional breakdown of all expense categories for the selected period.</li>
              <li>
                <strong>Click any slice</strong> to jump to Transactions filtered to that category.
              </li>
            </ul>
            <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">Breakdown tables</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Income by Category</strong> and <strong>Expenses by Category</strong> tables
                list each category with its total for the selected period.
              </li>
              <li>Click any category name to jump to its transactions.</li>
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
                monthly limit, amount spent so far, a progress bar, the percentage used, and a
                severity badge (on track / approaching / over budget).
              </li>
              <li>
                <strong>Forecast</strong> — projects end-of-month spend at the current daily rate,
                shown as a secondary percentage on each card.
              </li>
              <li>
                <strong>Need/Want badge</strong> — each card shows whether the category is
                classified as a Need or a Want (set on the Categories page).
              </li>
              <li>
                <strong>Historical chart</strong> — shows spending for that category over the past 6
                months alongside the budget limit, so you can see whether this month is typical.
              </li>
              <li>
                <strong>Add budget</strong> — create a budget scoped to a full category or a
                specific subcategory, and set the monthly limit.
              </li>
              <li>
                <strong>Edit / Delete</strong> — update the limit or remove a budget at any time.
              </li>
            </ul>
            <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">Budget Wizard</h3>
            <p>Automatically generates budget suggestions based on your spending history.</p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Custom mode</strong> — suggests limits based on your own average monthly
                spending over a configurable look-back period (e.g. last 3 or 6 months).
              </li>
              <li>
                <strong>50/30/20 mode</strong> — allocates income across Needs (50%), Wants (30%),
                and Savings (20%) using the Need/Want classification on each category. Requires
                categories to be classified first.
              </li>
              <li>
                Review and adjust every suggestion before creating them. Already-budgeted categories
                are skipped automatically.
              </li>
            </ul>
            <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">AI Summary</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                Claude generates a narrative, key insights, and recommendations based on the current
                month's budget performance. The result is cached; click <strong>Regenerate</strong>{" "}
                to get a fresh analysis.
              </li>
            </ul>
          </div>
        </section>

        {/* Transactions */}
        <section id="transactions">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Transactions</h2>
          <div className="prose prose-sm text-gray-600 space-y-2">
            <p>Browse, filter, edit, and re-enrich every transaction in the database.</p>
            <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">Filtering</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Filter bar</strong> — filter by date range, merchant, description, min/max
                amount, category, subcategory, account, import source, recurring flag, uncategorized
                flag, and cardholder. Autocomplete is available for merchant, category, subcategory,
                account, and cardholder fields.
              </li>
              <li>
                <strong>Natural-language search</strong> — type a plain-English query (e.g. "coffee
                shops last month" or "subscriptions over $10") and Claude translates it into filter
                parameters automatically.
              </li>
              <li>All active filters are stored in the URL for easy sharing and bookmarking.</li>
            </ul>
            <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">Sorting</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                Click any column header (Date, Description, Merchant, Category, Amount, Account) to
                sort ascending or descending.
              </li>
            </ul>
            <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">Editing</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Inline edit</strong> — click any transaction row to edit it directly:
                merchant (with live autocomplete), category, subcategory, description, notes, and
                cardholder. Clearing a field removes the association.
              </li>
              <li>
                New merchant and category names are created automatically on save (find-or-create).
              </li>
              <li>
                <strong>Exclude / Include</strong> — the edit modal has an <em>Exclude</em> button
                that removes the transaction from all income and expense calculations (monthly,
                yearly, overview). Excluded rows are still visible in the list with an
                &ldquo;excluded&rdquo; badge. Click <em>Include</em> in the modal to reverse it.
              </li>
            </ul>
            <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">Bulk actions</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Re-enrich</strong> — select one or more rows and send them back to Claude
                for fresh merchant and category detection.
              </li>
            </ul>
            <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">Other</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                Merchant logos are shown next to merchant names in the table (requires a logo.dev
                token in your environment).
              </li>
              <li>Transactions are paginated; click "Load more" to fetch the next page.</li>
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
                <strong>Category cards</strong> — each card shows the category name, total spending,
                a donut chart of subcategory proportions, and a sortable subcategory table (sort by
                total, transaction count, or name).
              </li>
              <li>
                <strong>Need/Want toggle</strong> — classify each category and subcategory as a{" "}
                <em>Need</em> (essential spending) or a <em>Want</em> (discretionary). This
                classification drives the Budget Wizard's 50/30/20 mode.
              </li>
              <li>
                <strong>Drill down</strong> — click a category or subcategory name to view its
                transactions.
              </li>
            </ul>
            <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">AI Summary</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                Claude generates a narrative, key insights, and recommendations for the selected
                date range. The result is cached; click <strong>Regenerate</strong> to get a fresh
                analysis.
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
                <strong>Month selector</strong> — pick any month from the sidebar (grouped by year);
                the report updates instantly. Loads the most recent month on first visit.
              </li>
              <li>
                <strong>Stat cards</strong> — income, expenses, net, and savings rate for the
                selected month, plus a link to all transactions in that month.
              </li>
              <li>
                <strong>Sunburst chart</strong> — hierarchical spending visualization with
                categories on the inner ring and subcategories on the outer ring. Click a segment to
                zoom in; click the centre to zoom back out.
              </li>
              <li>
                <strong>Category table</strong> — nested category and subcategory rows with totals
                and month-over-month percentage changes. Click any name to open Transactions
                filtered to that category and month.
              </li>
            </ul>
            <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">AI Summary</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                Claude generates a narrative, key insights, and recommendations for the selected
                month. The result is cached per month; click <strong>Regenerate</strong> to get a
                fresh analysis.
              </li>
            </ul>
          </div>
        </section>

        {/* Yearly */}
        <section id="yearly">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Yearly Reports</h2>
          <div className="prose prose-sm text-gray-600 space-y-2">
            <p>Detailed breakdown of income and spending for a full calendar year.</p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Year selector</strong> — pick any year from the sidebar; the report updates
                instantly.
              </li>
              <li>
                <strong>Stat cards</strong> — income, expenses, net, and savings rate for the
                selected year, with year-over-year percentage changes.
              </li>
              <li>
                <strong>Sunburst chart</strong> — same hierarchical visualization as Monthly, scoped
                to the full year. Click a segment to zoom in; click the centre to zoom back out.
              </li>
              <li>
                <strong>Category table</strong> — nested category and subcategory rows with totals
                and year-over-year percentage changes. Click any name to open Transactions filtered
                to that category and year.
              </li>
            </ul>
            <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">AI Summary</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                Claude generates a narrative, key insights, and recommendations for the selected
                year. The result is cached per year; click <strong>Regenerate</strong> to get a
                fresh analysis.
              </li>
            </ul>
          </div>
        </section>

        {/* Recurring */}
        <section id="recurring">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Recurring Charges</h2>
          <div className="prose prose-sm text-gray-600 space-y-2">
            <p>
              Claude automatically detects recurring charges (subscriptions, bills, etc.) during
              enrichment based on transaction history.
            </p>
            <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">Date filter</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                Use the <strong>From / To</strong> date pickers to narrow the list to a specific
                window (defaults to the last 6 months). Click <strong>Apply</strong> to update the
                view. The selected range is stored in the URL.
              </li>
            </ul>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Summary cards</strong> — total monthly cost, quarterly cost, annual cost,
                and subscription count across all detected recurring items.
              </li>
              <li>
                <strong>Category breakdown</strong> — aggregated recurring spend grouped by category
                and subcategory.
              </li>
              <li>
                <strong>Detail table</strong> — merchant (with logo), category, typical amount,
                frequency (weekly / biweekly / monthly / quarterly / annual), monthly equivalent
                cost, occurrence count, last charge date, and estimated next charge date.
              </li>
              <li>
                <strong>Overdue detection</strong> — if the estimated next charge date has passed,
                it is shown in bold red so you can check whether the charge appeared.
              </li>
              <li>
                <strong>Sort</strong> — sort by merchant, category, amount, frequency, monthly cost,
                occurrences, last charge, or next charge.
              </li>
              <li>Click a merchant name to view all of its transactions.</li>
            </ul>
            <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">AI Summary</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                Claude generates a narrative, key insights, and recommendations for the selected
                date range. The result is cached; click <strong>Regenerate</strong> to get a fresh
                analysis.
              </li>
            </ul>
          </div>
        </section>

        {/* Trends */}
        <section id="trends">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Category Trends</h2>
          <div className="prose prose-sm text-gray-600 space-y-2">
            <p>Visualize how spending in each category changes month over month.</p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Date range</strong> — choose a start and end month with the From/To pickers,
                then click Apply. The selected range is saved in the URL.
              </li>
              <li>
                <strong>Multi-line chart</strong> — one line per expense category, showing monthly
                totals over the selected range. Hover over any point to see the exact amount.
              </li>
              <li>
                Useful for spotting categories where spending is growing or shrinking over time.
              </li>
            </ul>
            <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">AI Summary</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                Claude generates a narrative, key insights, and recommendations for the selected
                date range. The result is cached; click <strong>Regenerate</strong> to get a fresh
                analysis.
              </li>
            </ul>
          </div>
        </section>

        {/* Accounts */}
        <section id="accounts">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Accounts</h2>
          <div className="prose prose-sm text-gray-600 space-y-2">
            <p>View all bank and credit card accounts that have been imported.</p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Account list</strong> — shows account name, institution, type (checking,
                savings, credit card, etc.), date created, transaction count, and total amount.
              </li>
              <li>
                <strong>Filter &amp; sort</strong> — filter by name, institution, or type; sort by
                any column.
              </li>
              <li>
                <strong>Drill down</strong> — click an account name to open Transactions filtered to
                that account.
              </li>
              <li>If no accounts exist yet, a link to the Imports page is shown.</li>
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
              Merchants are detected and normalized by Claude during import. This page lets you
              view, edit, and merge them.
            </p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Merchant list</strong> — logo, name, location, transaction count, and total
                spend. Filter by name or location; sort by any column.
              </li>
              <li>
                <strong>Edit</strong> — click a merchant row to open the detail modal; edit the
                name, location, and website URL.
              </li>
              <li>
                <strong>View transactions</strong> — each detail modal links to Transactions
                filtered to that merchant.
              </li>
            </ul>
            <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">Merge Duplicates</h3>
            <p>
              Claude scans all merchant names and returns groups of likely duplicates (e.g.
              "Starbucks" and "STARBUCKS #0423").
            </p>
            <ul className="list-disc list-inside space-y-1">
              <li>For each group, set a canonical name and click Merge, or skip the group.</li>
              <li>
                All transactions from the merged merchants are reassigned to the canonical merchant.
              </li>
              <li>Merchants with the same name but different locations are kept separate.</li>
            </ul>
          </div>
        </section>

        {/* Card Holders */}
        <section id="card-holders">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Card Holders</h2>
          <div className="prose prose-sm text-gray-600 space-y-2">
            <p>
              Track spending by individual cardholder on shared accounts. Card holder data is
              detected from your CSV if the bank includes it.
            </p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Cardholder list</strong> — shows last 4 digits of the card number, the
                assigned name (if any), transaction count, and total spend.
              </li>
              <li>
                <strong>Assign a name</strong> — click the edit icon to assign a friendly name to a
                card number (e.g. "Alice" for card ending in 1234).
              </li>
              <li>
                <strong>Filter</strong> — filter by last 4 digits or cardholder name.
              </li>
              <li>
                <strong>Drill down</strong> — click a cardholder row to view their transactions in
                the Transactions page.
              </li>
            </ul>
          </div>
        </section>

        {/* Imports */}
        <section id="imports">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Importing Transactions</h2>
          <div className="prose prose-sm text-gray-600 space-y-2">
            <p>Import transactions from a CSV file exported from your bank or credit card.</p>
            <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">Uploading a file</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                Enter an account name (required), optionally select the account type (checking,
                savings, credit card, investment, cash), and choose your CSV file.
              </li>
              <li>
                Claude automatically detects which columns map to date, description, and amount — no
                manual column mapping needed.
              </li>
              <li>
                Each transaction is fingerprinted by its account, date, amount, and description.
                Re-importing an overlapping CSV skips already-present rows and preserves their
                enrichment data. Two genuine identical purchases on the same day are kept
                separately.
              </li>
            </ul>
            <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">Background enrichment</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                After upload, Claude processes transactions in batches to assign merchants,
                categories, subcategories, and recurring flags.
              </li>
              <li>
                A progress bar shows how many rows have been processed out of the total. Skipped
                duplicate rows count toward progress and are reported separately once the import
                completes.
              </li>
              <li>
                <strong>Abort</strong> — cancel an in-progress enrichment job; already-enriched rows
                are kept.
              </li>
            </ul>
            <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">Import history</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                All imports are listed with filename, account, date, row count, transaction count,
                and status (complete / in-progress / aborted).
              </li>
              <li>
                <strong>Re-enrich</strong> — run enrichment again on a completed import to
                re-classify its transactions (e.g. after updating category or merchant data).
              </li>
              <li>Click the transaction count to view that import's transactions.</li>
            </ul>
          </div>
        </section>

        {/* Tags */}
        <section id="tags">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Tags</h2>
          <div className="prose prose-sm text-gray-600 space-y-2">
            <p>
              Tags are labels attached to individual transactions. They provide a flexible way to
              group and find transactions that don&apos;t fit neatly into a single category — for
              example, tagging expenses that belong to a specific trip, project, or event.
            </p>
            <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">How tags are assigned</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>AI enrichment</strong> — Claude suggests tags automatically when
                transactions are imported, based on the merchant and description.
              </li>
              <li>
                <strong>Manual tagging</strong> — open any transaction&apos;s edit modal from the
                Transactions page and add or remove tags in the Tags field. Multiple tags can be
                applied to a single transaction.
              </li>
            </ul>
            <h3 className="text-sm font-semibold text-gray-800 mt-4 mb-1">Tags page</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                Lists every tag with its transaction count and total amount across all tagged
                transactions.
              </li>
              <li>
                Use the <strong>Name</strong> filter to search for a specific tag by name.
              </li>
              <li>
                Click any column header to sort by that column. Clicking the same header again
                toggles between ascending and descending order.
              </li>
              <li>
                Click a tag name to navigate to the Transactions page pre-filtered to show only
                transactions with that tag.
              </li>
            </ul>
          </div>
        </section>

        {/* Duplicates */}
        <section id="duplicates">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">Duplicate Transactions</h2>
          <div className="prose prose-sm text-gray-600 space-y-2">
            <p>
              The Duplicates page surfaces transaction groups that share the same account, date, and
              amount. This can happen when the same transaction appears in two overlapping CSV
              exports, or when a bank records a single charge twice.
            </p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                Each duplicate group is shown as a card with the shared date, amount, and account in
                the header, and each matching transaction as a row below.
              </li>
              <li>
                Click <strong>Exclude</strong> on any row to remove it from analytics. The row
                disappears from the Duplicates page; if only one transaction remains in the group,
                the card collapses automatically.
              </li>
              <li>
                Excluded transactions are still visible in the Transactions list with an
                &ldquo;excluded&rdquo; badge and can be re-included from the edit modal at any time.
              </li>
              <li>
                Note: transactions are deduplicated by fingerprint when imported, so truly identical
                rows (same account, date, amount, and description) in the same CSV are only imported
                once. The Duplicates page catches cases where the description differs slightly or
                where the same transaction appears in two different CSV files.
              </li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
