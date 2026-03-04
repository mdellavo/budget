import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getDuplicateTransactions, updateTransaction } from "../api/client";
import HelpIcon from "../components/HelpIcon";
import type { TransactionItem } from "../types";

function formatAmount(amount: string): { text: string; positive: boolean } {
  const n = parseFloat(amount);
  return {
    text: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n),
    positive: n >= 0,
  };
}

interface DuplicateGroupProps {
  group: TransactionItem[];
  onExclude: (txId: number) => void;
  excluding: Set<number>;
}

function DuplicateGroup({ group, onExclude, excluding }: DuplicateGroupProps) {
  const first = group[0];
  const { text: amountText, positive } = formatAmount(first.amount);

  return (
    <div className="bg-white rounded-lg border border-amber-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-center gap-4 text-sm">
        <span className="font-medium text-gray-700">{first.date}</span>
        <span className={`font-mono font-semibold ${positive ? "text-green-600" : "text-red-600"}`}>
          {amountText}
        </span>
        <span className="text-gray-500">{first.account}</span>
        <span className="ml-auto text-xs text-amber-600 font-medium">
          {group.length} transactions
        </span>
      </div>
      <div className="divide-y divide-gray-100">
        {group.map((tx) => {
          const txLink = `/transactions?date_from=${tx.date}&date_to=${tx.date}&account=${encodeURIComponent(tx.account)}`;
          return (
            <div key={tx.id} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-900 truncate">{tx.description}</div>
                <div className="flex gap-3 mt-0.5 text-xs text-gray-500">
                  {tx.merchant && <span>{tx.merchant}</span>}
                  {tx.category && (
                    <span>
                      {tx.category}
                      {tx.subcategory ? ` › ${tx.subcategory}` : ""}
                    </span>
                  )}
                </div>
              </div>
              <Link
                to={txLink}
                className="shrink-0 px-3 py-1.5 text-xs font-medium text-gray-500 border border-gray-200 rounded hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400"
                title="View in Transactions"
              >
                View
              </Link>
              <button
                type="button"
                onClick={() => onExclude(tx.id)}
                disabled={excluding.has(tx.id)}
                className="shrink-0 px-3 py-1.5 text-xs font-medium text-amber-700 border border-amber-300 rounded hover:bg-amber-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                {excluding.has(tx.id) ? "Excluding…" : "Exclude"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DuplicatesPage() {
  const [groups, setGroups] = useState<TransactionItem[][] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [excluding, setExcluding] = useState<Set<number>>(new Set());

  useEffect(() => {
    setLoading(true);
    getDuplicateTransactions()
      .then((res) => setGroups(res.groups))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  async function handleExclude(txId: number) {
    setExcluding((prev) => new Set([...prev, txId]));
    try {
      // Find the transaction to get its current description
      const tx = groups?.flat().find((t) => t.id === txId);
      if (!tx) return;
      await updateTransaction(txId, {
        description: tx.description,
        merchant_name: tx.merchant ?? null,
        category: tx.category ?? null,
        subcategory: tx.subcategory ?? null,
        notes: tx.notes ?? null,
        tags: tx.tags ?? [],
        is_excluded: true,
      });
      // Remove the excluded transaction from local state
      setGroups((prev) => {
        if (!prev) return prev;
        return prev
          .map((group) => group.filter((t) => t.id !== txId))
          .filter((group) => group.length > 1);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to exclude");
    } finally {
      setExcluding((prev) => {
        const next = new Set(prev);
        next.delete(txId);
        return next;
      });
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900">Duplicate Transactions</h1>
          <HelpIcon section="duplicates" />
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Transactions sharing the same account, date, and amount. Exclude extras to keep your
          analytics accurate. Excluded transactions remain visible in the Transactions list.
        </p>
      </div>

      {loading && <div className="text-sm text-gray-500">Loading…</div>}

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
          {error}
        </div>
      )}

      {!loading && !error && groups !== null && groups.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">✓</div>
          <div className="text-sm font-medium">No duplicates found</div>
        </div>
      )}

      {groups && groups.length > 0 && (
        <div className="space-y-4">
          {groups.map((group, i) => (
            <DuplicateGroup
              key={`${group[0].account_id}-${group[0].date}-${group[0].amount}-${i}`}
              group={group}
              onExclude={handleExclude}
              excluding={excluding}
            />
          ))}
        </div>
      )}
    </div>
  );
}
