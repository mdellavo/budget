import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { listAccounts } from "../api/client";
import type { AccountFilters } from "../api/client";
import type { AccountItem } from "../types";

type SortKey = "name" | "institution" | "account_type" | "created_at" | "transaction_count" | "total_amount";

const COLUMNS: { label: string; key: SortKey; rightAlign?: boolean }[] = [
  { label: "Name",        key: "name" },
  { label: "Institution", key: "institution" },
  { label: "Type",        key: "account_type" },
  { label: "Created At",  key: "created_at" },
  { label: "Txn Count",   key: "transaction_count", rightAlign: true },
  { label: "Total Amount", key: "total_amount",      rightAlign: true },
];

function formatAmount(amount: string): { text: string; positive: boolean } {
  const n = parseFloat(amount);
  return {
    text: new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(n),
    positive: n >= 0,
  };
}

const EMPTY_FILTERS = { name: "", institution: "", account_type: "" };
type FormFilters = typeof EMPTY_FILTERS;

export default function AccountsPage() {
  const [filters, setFilters] = useState<FormFilters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<FormFilters>(EMPTY_FILTERS);
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [pages, setPages] = useState<AccountItem[][]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFirstPage = useCallback(async (formFilters: FormFilters, sb: SortKey, sd: "asc" | "desc") => {
    setLoading(true);
    setError(null);
    setPages([]);
    setNextCursor(null);
    setHasMore(false);
    const apiFilters: AccountFilters = { sort_by: sb, sort_dir: sd };
    if (formFilters.name) apiFilters.name = formFilters.name;
    if (formFilters.institution) apiFilters.institution = formFilters.institution;
    if (formFilters.account_type) apiFilters.account_type = formFilters.account_type;
    try {
      const res = await listAccounts(apiFilters);
      setPages([res.items]);
      setNextCursor(res.next_cursor);
      setHasMore(res.has_more);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFirstPage(appliedFilters, sortBy, sortDir);
  }, [appliedFilters, sortBy, sortDir, fetchFirstPage]);

  function handleSort(key: SortKey) {
    if (key === sortBy) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    const apiFilters: AccountFilters = {
      sort_by: sortBy,
      sort_dir: sortDir,
      after: nextCursor,
    };
    if (appliedFilters.name) apiFilters.name = appliedFilters.name;
    if (appliedFilters.institution) apiFilters.institution = appliedFilters.institution;
    if (appliedFilters.account_type) apiFilters.account_type = appliedFilters.account_type;
    try {
      const res = await listAccounts(apiFilters);
      setPages((prev) => [...prev, res.items]);
      setNextCursor(res.next_cursor);
      setHasMore(res.has_more);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }

  function handleApply(e: React.FormEvent) {
    e.preventDefault();
    setAppliedFilters(filters);
  }

  function handleClear() {
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
  }

  const allRows = pages.flat();

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Accounts</h1>

      {/* Filter bar */}
      <form
        onSubmit={handleApply}
        className="mb-6 bg-white border border-gray-200 rounded-md shadow-sm p-4"
      >
        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Name</label>
            <input
              type="text"
              value={filters.name}
              onChange={(e) => setFilters((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Checking"
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Institution</label>
            <input
              type="text"
              value={filters.institution}
              onChange={(e) => setFilters((f) => ({ ...f, institution: e.target.value }))}
              placeholder="e.g. Chase"
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Type</label>
            <input
              type="text"
              value={filters.account_type}
              onChange={(e) => setFilters((f) => ({ ...f, account_type: e.target.value }))}
              placeholder="e.g. checking"
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex-1" />
          <div className="flex gap-2">
            <button
              type="submit"
              className="px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="px-4 py-1.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              Clear
            </button>
          </div>
        </div>
      </form>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {COLUMNS.map(({ label, key, rightAlign }) => (
                <th key={key} className={`px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider ${rightAlign ? "text-right" : "text-left"}`}>
                  <button
                    onClick={() => handleSort(key)}
                    className="flex items-center gap-1 hover:text-gray-800 transition-colors"
                  >
                    {label}
                    <span className="text-gray-400">
                      {sortBy === key ? (sortDir === "asc" ? "↑" : "↓") : ""}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                  <div className="flex items-center justify-center gap-2">
                    <svg
                      className="animate-spin h-4 w-4 text-indigo-500"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v8H4z"
                      />
                    </svg>
                    Loading…
                  </div>
                </td>
              </tr>
            ) : allRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                  No accounts found.{" "}
                  <a href="/import" className="text-indigo-600 hover:underline">
                    Import a CSV
                  </a>{" "}
                  to create one.
                </td>
              </tr>
            ) : (
              allRows.map((row) => {
                const { text, positive } = formatAmount(row.total_amount);
                return (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-800">
                      <Link
                        to={`/transactions?account=${encodeURIComponent(row.name)}`}
                        className="text-indigo-600 hover:underline"
                      >
                        {row.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-gray-600">{row.institution ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-2 text-gray-600">{row.account_type ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-2 text-gray-600 tabular-nums">
                      {new Date(row.created_at).toLocaleDateString("en-US")}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-600 tabular-nums">
                      {row.transaction_count}
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-mono whitespace-nowrap ${
                        positive ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {text}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      {hasMore && !loading && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="flex items-center gap-2 px-5 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded hover:bg-gray-50 disabled:opacity-50"
          >
            {loadingMore ? (
              <>
                <svg
                  className="animate-spin h-4 w-4 text-gray-500"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8H4z"
                  />
                </svg>
                Loading…
              </>
            ) : (
              "Load more"
            )}
          </button>
        </div>
      )}
    </div>
  );
}
