import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { listTags } from "../api/client";
import HelpIcon from "../components/HelpIcon";
import type { TagFilters } from "../api/client";
import type { TagItem } from "../types";

type SortKey = "name" | "transaction_count" | "total_amount";

const COLUMNS: { label: string; key: SortKey; rightAlign?: boolean }[] = [
  { label: "Tag", key: "name" },
  { label: "Transactions", key: "transaction_count", rightAlign: true },
  { label: "Total Amount", key: "total_amount", rightAlign: true },
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

export default function TagsPage() {
  const [nameInput, setNameInput] = useState("");
  const [appliedName, setAppliedName] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [rows, setRows] = useState<TagItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTags = useCallback(async (name: string, sb: SortKey, sd: "asc" | "desc") => {
    setLoading(true);
    setError(null);
    const filters: TagFilters = { sort_by: sb, sort_dir: sd };
    if (name) filters.name = name;
    try {
      const res = await listTags(filters);
      setRows(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tags");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTags(appliedName, sortBy, sortDir);
  }, [appliedName, sortBy, sortDir, loadTags]);

  function handleSort(key: SortKey) {
    if (key === sortBy) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  function handleApply(e: React.FormEvent) {
    e.preventDefault();
    setAppliedName(nameInput);
  }

  function handleClear() {
    setNameInput("");
    setAppliedName("");
  }

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-gray-900">Tags</h1>
          <HelpIcon section="tags" />
        </div>
        <p className="text-sm text-gray-500 mt-0.5">
          Transaction tags assigned by AI during enrichment or added manually.
        </p>
      </div>

      {/* Filter bar */}
      <form
        onSubmit={handleApply}
        className="mb-6 bg-white border border-gray-200 rounded-md shadow-sm p-4"
      >
        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex flex-col gap-1 w-full sm:w-auto">
            <label className="text-xs text-gray-500 font-medium">Name</label>
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="e.g. travel"
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
                <th
                  key={key}
                  className={`px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider ${rightAlign ? "text-right" : "text-left"}`}
                >
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
                <td colSpan={3} className="px-4 py-10 text-center text-gray-400">
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
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Loading…
                  </div>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-sm text-gray-400">
                  No tags found.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const { text, positive } = formatAmount(row.total_amount);
                return (
                  <tr key={row.name} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-800">
                      <Link
                        to={`/transactions?tag=${encodeURIComponent(row.name)}`}
                        className="text-indigo-600 hover:underline"
                      >
                        {row.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right text-gray-600 tabular-nums">
                      {row.transaction_count}
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-mono whitespace-nowrap ${positive ? "text-green-600" : "text-red-600"}`}
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
    </div>
  );
}
