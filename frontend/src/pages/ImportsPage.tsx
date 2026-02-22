import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { listImports, importCsv, getImportProgress, ApiResponseError } from "../api/client";
import type { ImportFilters } from "../api/client";
import type { ImportItem, ImportCsvResponse, ColumnMapping } from "../types";

type SortKey = "filename" | "account" | "imported_at" | "row_count" | "transaction_count";

const COLUMNS: { label: string; key: SortKey; rightAlign?: boolean }[] = [
  { label: "Filename",    key: "filename" },
  { label: "Account",     key: "account" },
  { label: "Imported At", key: "imported_at" },
  { label: "Rows",        key: "row_count",         rightAlign: true },
  { label: "Txn Count",  key: "transaction_count",  rightAlign: true },
];

const EMPTY_FILTERS = { filename: "", account: "" };
type FormFilters = typeof EMPTY_FILTERS;

type ImportState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: ImportCsvResponse }
  | { status: "error"; message: string };

function ColumnMappingTable({ columns, mapping }: { columns: string[]; mapping: ColumnMapping }) {
  const rows = [
    { target: "Date", index: mapping.date },
    { target: "Description", index: mapping.description },
    { target: "Amount", index: mapping.amount },
  ];
  return (
    <table className="mt-3 w-full text-sm border-collapse">
      <thead>
        <tr className="border-b border-green-300">
          <th className="text-left py-1 pr-4 font-medium text-green-800">Target column</th>
          <th className="text-left py-1 font-medium text-green-800">CSV column</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ target, index }) => (
          <tr key={target} className="border-b border-green-200 last:border-0">
            <td className="py-1 pr-4 text-green-900">{target}</td>
            <td className="py-1 text-green-900">
              {index !== null ? (
                <span>
                  <span className="text-green-600 font-mono text-xs mr-2">[{index}]</span>
                  {columns[index] ?? "—"}
                </span>
              ) : (
                <span className="text-green-500 italic">not detected</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ImportsPage() {
  // List state
  const [filters, setFilters] = useState<FormFilters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<FormFilters>(EMPTY_FILTERS);
  const [sortBy, setSortBy] = useState<SortKey>("imported_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [pages, setPages] = useState<ImportItem[][]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Import form state
  const [showImportForm, setShowImportForm] = useState(false);
  const [importState, setImportState] = useState<ImportState>({ status: "idle" });
  const [enrichedRows, setEnrichedRows] = useState(0);
  const [enrichmentComplete, setEnrichmentComplete] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFirstPage = useCallback(async (formFilters: FormFilters, sb: SortKey, sd: "asc" | "desc") => {
    setLoading(true);
    setError(null);
    setPages([]);
    setNextCursor(null);
    setHasMore(false);
    const apiFilters: ImportFilters = { sort_by: sb, sort_dir: sd };
    if (formFilters.filename) apiFilters.filename = formFilters.filename;
    if (formFilters.account) apiFilters.account = formFilters.account;
    try {
      const res = await listImports(apiFilters);
      setPages([res.items]);
      setNextCursor(res.next_cursor);
      setHasMore(res.has_more);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load imports");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFirstPage(appliedFilters, sortBy, sortDir);
  }, [appliedFilters, sortBy, sortDir, fetchFirstPage]);

  useEffect(() => {
    if (importState.status !== "success" || enrichmentComplete) return;
    const id = setInterval(async () => {
      try {
        const p = await getImportProgress(importState.data.csv_import_id);
        setEnrichedRows(p.enriched_rows);
        if (p.complete) {
          setEnrichmentComplete(true);
          fetchFirstPage(appliedFilters, sortBy, sortDir);
        }
      } catch {
        // ignore transient poll errors
      }
    }, 2000);
    return () => clearInterval(id);
  }, [importState.status, importState.status === "success" ? importState.data.csv_import_id : null, enrichmentComplete, fetchFirstPage, appliedFilters, sortBy, sortDir]);

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
    const apiFilters: ImportFilters = { sort_by: sortBy, sort_dir: sortDir, after: nextCursor };
    if (appliedFilters.filename) apiFilters.filename = appliedFilters.filename;
    if (appliedFilters.account) apiFilters.account = appliedFilters.account;
    try {
      const res = await listImports(apiFilters);
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

  async function handleImportSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setImportState({ status: "error", message: "Please select a CSV file." });
      return;
    }
    if (!accountName.trim()) {
      setImportState({ status: "error", message: "Please enter an account name." });
      return;
    }
    setImportState({ status: "loading" });
    try {
      const data = await importCsv(file, accountName.trim(), accountType || undefined);
      setImportState({ status: "success", data });
      fetchFirstPage(appliedFilters, sortBy, sortDir);
    } catch (err) {
      const message =
        err instanceof ApiResponseError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "An unexpected error occurred.";
      setImportState({ status: "error", message });
    }
  }

  function handleImportReset() {
    setImportState({ status: "idle" });
    setFile(null);
    setAccountName("");
    setAccountType("");
    setEnrichedRows(0);
    setEnrichmentComplete(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleCloseImportForm() {
    setShowImportForm(false);
    handleImportReset();
  }

  const allRows = pages.flat();
  const hasInProgress = allRows.some(r => r.status === "in-progress");

  useEffect(() => {
    if (!hasInProgress) return;
    const id = setInterval(() => {
      fetchFirstPage(appliedFilters, sortBy, sortDir);
    }, 2000);
    return () => clearInterval(id);
  }, [hasInProgress, appliedFilters, sortBy, sortDir, fetchFirstPage]);

  const isImporting = importState.status === "loading";

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Imports</h1>
        <button
          onClick={() => setShowImportForm(f => !f)}
          className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          ⬆ Import CSV
        </button>
      </div>

      {/* Import panel */}
      {showImportForm && (
        <div className="mb-6 bg-white border border-gray-200 rounded-md shadow-sm p-6">
          {importState.status === "error" && (
            <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
              {importState.message}
            </div>
          )}

          {importState.status === "success" ? (
            <div className="rounded-md bg-green-50 border border-green-200 px-6 py-5">
              <h2 className="text-base font-semibold text-green-900 mb-1">Import started</h2>
              {enrichmentComplete ? (
                <p className="text-sm text-green-800 mb-4">Enrichment complete.</p>
              ) : (
                <div className="mb-4">
                  <p className="text-sm text-green-800 mb-2">
                    Enriching {enrichedRows} / {importState.data.rows_imported} rows…
                  </p>
                  <div className="w-full bg-green-200 rounded-full h-2">
                    <div
                      className="bg-green-600 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, (enrichedRows / importState.data.rows_imported) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
              <dl className="text-sm grid grid-cols-2 gap-x-4 gap-y-2 mb-4">
                <dt className="font-medium text-green-800">File</dt>
                <dd className="text-green-900">{importState.data.filename}</dd>
                <dt className="font-medium text-green-800">Rows imported</dt>
                <dd className="text-green-900">{importState.data.rows_imported}</dd>
                <dt className="font-medium text-green-800">Import ID</dt>
                <dd className="text-green-900">#{importState.data.csv_import_id}</dd>
              </dl>
              <p className="text-sm font-medium text-green-800">Detected column mapping</p>
              <ColumnMappingTable columns={importState.data.columns} mapping={importState.data.column_mapping} />
              <div className="mt-5 flex gap-4">
                <button
                  onClick={handleImportReset}
                  className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                >
                  Import another file
                </button>
                <button
                  onClick={handleCloseImportForm}
                  className="text-sm text-gray-500 hover:text-gray-700 font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleImportSubmit} className="space-y-5">
              <div>
                <label htmlFor="account-name" className="block text-sm font-medium text-gray-700 mb-1">
                  Account name
                </label>
                <input
                  id="account-name"
                  type="text"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  disabled={isImporting}
                  placeholder="e.g. Chase Checking"
                  className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
                />
              </div>
              <div>
                <label htmlFor="account-type" className="block text-sm font-medium text-gray-700 mb-1">
                  Account type <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <select
                  id="account-type"
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value)}
                  disabled={isImporting}
                  className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
                >
                  <option value="">— select —</option>
                  <option>Checking</option>
                  <option>Savings</option>
                  <option>Credit Card</option>
                  <option>Investment</option>
                  <option>Cash</option>
                </select>
              </div>
              <div>
                <label htmlFor="csv-file" className="block text-sm font-medium text-gray-700 mb-1">
                  CSV file
                </label>
                <input
                  id="csv-file"
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  disabled={isImporting}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 disabled:opacity-50"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={isImporting}
                  className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isImporting && (
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  )}
                  {isImporting ? "Importing…" : "Import"}
                </button>
                <button
                  type="button"
                  onClick={handleCloseImportForm}
                  disabled={isImporting}
                  className="px-4 py-2.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Filter bar */}
      <form onSubmit={handleApply} className="mb-6 bg-white border border-gray-200 rounded-md shadow-sm p-4">
        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Filename</label>
            <input
              type="text"
              value={filters.filename}
              onChange={(e) => setFilters((f) => ({ ...f, filename: e.target.value }))}
              placeholder="e.g. chase"
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Account</label>
            <input
              type="text"
              value={filters.account}
              onChange={(e) => setFilters((f) => ({ ...f, account: e.target.value }))}
              placeholder="e.g. Checking"
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
                  <button onClick={() => handleSort(key)} className="flex items-center gap-1 hover:text-gray-800 transition-colors">
                    {label}
                    <span className="text-gray-400">{sortBy === key ? (sortDir === "asc" ? "↑" : "↓") : ""}</span>
                  </button>
                </th>
              ))}
              <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider text-left">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                  <div className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Loading…
                  </div>
                </td>
              </tr>
            ) : allRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                  No imports yet.{" "}
                  <button
                    onClick={() => setShowImportForm(true)}
                    className="text-indigo-600 hover:underline"
                  >
                    Import a CSV
                  </button>{" "}
                  to get started.
                </td>
              </tr>
            ) : (
              allRows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-800 font-mono text-xs">{row.filename}</td>
                  <td className="px-4 py-2 text-gray-600">{row.account ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-2 text-gray-600 tabular-nums whitespace-nowrap">
                    {new Date(row.imported_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-600 tabular-nums">{row.row_count}</td>
                  <td className="px-4 py-2 text-right text-gray-600 tabular-nums">
                    <Link
                      to={`/transactions?import_id=${row.id}`}
                      className="text-indigo-600 hover:underline"
                    >
                      {row.transaction_count}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    {row.status === "complete" ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700">
                        Complete
                      </span>
                    ) : (
                      <div className="min-w-[120px]">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-gray-500">Enriching…</span>
                          <span className="text-xs text-gray-500">
                            {row.enriched_rows}/{row.row_count}
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-1.5">
                          <div
                            className="bg-indigo-500 h-1.5 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(100, (row.enriched_rows / row.row_count) * 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ))
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
                <svg className="animate-spin h-4 w-4 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
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
