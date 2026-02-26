import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { listCardHolders, updateCardHolder } from "../api/client";
import HelpIcon from "../components/HelpIcon";
import type { CardHolderFilters } from "../api/client";
import type { CardHolderItem } from "../types";

type SortKey = "name" | "card_number" | "transaction_count" | "total_amount";

const COLUMNS: { label: string; key: SortKey; rightAlign?: boolean }[] = [
  { label: "Card Number", key: "card_number" },
  { label: "Name", key: "name" },
  { label: "Transaction Count", key: "transaction_count", rightAlign: true },
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

const EMPTY_FILTERS = { name: "", card_number: "" };
type FormFilters = typeof EMPTY_FILTERS;

// ---------------------------------------------------------------------------
// Details modal
// ---------------------------------------------------------------------------
function DetailsModal({
  cardholder,
  onEdit,
  onClose,
}: {
  cardholder: CardHolderItem;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { text, positive } = formatAmount(cardholder.total_amount);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-sm mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {cardholder.card_number ? (
              `ending in ${cardholder.card_number}`
            ) : (
              <span className="text-gray-400 italic">No card number</span>
            )}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 ml-4 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <dl className="space-y-3 text-sm mb-6">
          <div className="flex justify-between">
            <dt className="text-gray-500">Card Number</dt>
            <dd className="font-mono text-gray-800">
              {cardholder.card_number ? (
                `ending in ${cardholder.card_number}`
              ) : (
                <span className="text-gray-400 italic">none</span>
              )}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Name / Label</dt>
            <dd className="text-gray-800">
              {cardholder.name ?? <span className="text-gray-400 italic">none</span>}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Transactions</dt>
            <dd className="text-gray-800">{cardholder.transaction_count}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Total amount</dt>
            <dd className={positive ? "text-green-600 font-mono" : "text-red-600 font-mono"}>
              {text}
            </dd>
          </div>
        </dl>

        <div className="flex gap-2 justify-between">
          {cardholder.card_number && (
            <Link
              to={`/transactions?cardholder=${encodeURIComponent(cardholder.card_number)}`}
              className="text-sm text-indigo-600 hover:underline"
              onClick={onClose}
            >
              View transactions →
            </Link>
          )}
          <button
            onClick={onEdit}
            className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 ml-auto"
          >
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit modal
// ---------------------------------------------------------------------------
function EditModal({
  cardholder,
  onSaved,
  onClose,
}: {
  cardholder: CardHolderItem;
  onSaved: (updated: CardHolderItem) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(cardholder.name ?? "");
  const [cardNumber, setCardNumber] = useState(cardholder.card_number ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await updateCardHolder(cardholder.id, {
        name: name.trim() || null,
        card_number: cardNumber.trim() || null,
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-sm mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Edit card holder</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 ml-4 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 font-medium mb-1">Card Number</label>
            <input
              type="text"
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
              placeholder="e.g. 1234"
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 font-medium mb-1">Name / Label</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alice's card"
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {error && <p className="text-red-600 text-xs">{error}</p>}

          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function CardHoldersPage() {
  const [filters, setFilters] = useState<FormFilters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<FormFilters>(EMPTY_FILTERS);
  const [sortBy, setSortBy] = useState<SortKey>("card_number");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [pages, setPages] = useState<CardHolderItem[][]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detailsCardholder, setDetailsCardholder] = useState<CardHolderItem | null>(null);
  const [editCardholder, setEditCardholder] = useState<CardHolderItem | null>(null);

  const fetchFirstPage = useCallback(
    async (formFilters: FormFilters, sb: SortKey, sd: "asc" | "desc") => {
      setLoading(true);
      setError(null);
      setPages([]);
      setNextCursor(null);
      setHasMore(false);
      const apiFilters: CardHolderFilters = { sort_by: sb, sort_dir: sd };
      if (formFilters.name) apiFilters.name = formFilters.name;
      if (formFilters.card_number) apiFilters.card_number = formFilters.card_number;
      try {
        const res = await listCardHolders(apiFilters);
        setPages([res.items]);
        setNextCursor(res.next_cursor);
        setHasMore(res.has_more);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load card holders");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchFirstPage(appliedFilters, sortBy, sortDir);
  }, [appliedFilters, sortBy, sortDir, fetchFirstPage]);

  function handleSort(key: SortKey) {
    if (key === sortBy) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("asc");
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    const apiFilters: CardHolderFilters = {
      sort_by: sortBy,
      sort_dir: sortDir,
      after: nextCursor,
    };
    if (appliedFilters.name) apiFilters.name = appliedFilters.name;
    if (appliedFilters.card_number) apiFilters.card_number = appliedFilters.card_number;
    try {
      const res = await listCardHolders(apiFilters);
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

  function handleSaved(updated: CardHolderItem) {
    setPages((prev) => prev.map((page) => page.map((ch) => (ch.id === updated.id ? updated : ch))));
    if (detailsCardholder?.id === updated.id) setDetailsCardholder(updated);
    setEditCardholder(null);
  }

  function openEdit(cardholder: CardHolderItem) {
    setDetailsCardholder(null);
    setEditCardholder(cardholder);
  }

  const allRows = pages.flat();

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-gray-900">Card Holders</h1>
          <HelpIcon section="card-holders" />
        </div>
      </div>

      {/* Filter bar */}
      <form
        onSubmit={handleApply}
        className="mb-6 bg-white border border-gray-200 rounded-md shadow-sm p-4"
      >
        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Card Number</label>
            <input
              type="text"
              value={filters.card_number}
              onChange={(e) => setFilters((f) => ({ ...f, card_number: e.target.value }))}
              placeholder="e.g. 1234"
              className="border border-gray-300 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Name</label>
            <input
              type="text"
              value={filters.name}
              onChange={(e) => setFilters((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Alice"
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
              <th className="px-4 py-3 w-16" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-gray-400">
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
            ) : allRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">
                  No card holders found.
                </td>
              </tr>
            ) : (
              allRows.map((row) => {
                const { text, positive } = formatAmount(row.total_amount);
                return (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-800">
                      <button
                        onClick={() => setDetailsCardholder(row)}
                        className="font-mono text-indigo-600 hover:underline text-left"
                      >
                        {row.card_number ? (
                          `ending in ${row.card_number}`
                        ) : (
                          <span className="text-gray-400 italic">none</span>
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {row.name ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-600 tabular-nums">
                      {row.transaction_count}
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-mono whitespace-nowrap ${positive ? "text-green-600" : "text-red-600"}`}
                    >
                      {text}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => openEdit(row)}
                        title="Edit card holder"
                        className="text-gray-400 hover:text-gray-700 p-1 rounded hover:bg-gray-100"
                      >
                        ✎
                      </button>
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

      {/* Modals */}
      {detailsCardholder && (
        <DetailsModal
          cardholder={detailsCardholder}
          onEdit={() => openEdit(detailsCardholder)}
          onClose={() => setDetailsCardholder(null)}
        />
      )}
      {editCardholder && (
        <EditModal
          cardholder={editCardholder}
          onSaved={handleSaved}
          onClose={() => setEditCardholder(null)}
        />
      )}
    </div>
  );
}
