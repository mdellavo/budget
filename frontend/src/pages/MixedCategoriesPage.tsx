import { useState, useEffect } from "react";
import { getMixedCategoryMerchants, updateTransaction } from "../api/client";
import HelpIcon from "../components/HelpIcon";
import { formatCurrency, amountColor } from "../lib/format";
import type { MixedCategoryMerchant, MixedCategoryTransaction } from "../types";

const CATEGORY_COLORS = [
  "bg-blue-100 text-blue-700",
  "bg-purple-100 text-purple-700",
  "bg-orange-100 text-orange-700",
  "bg-teal-100 text-teal-700",
];

function categoryColor(index: number): string {
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length];
}

interface MerchantCardProps {
  group: MixedCategoryMerchant;
  selected: Set<number>;
  onToggle: (id: number) => void;
  onToggleAll: (ids: number[], select: boolean) => void;
}

function MerchantCard({ group, selected, onToggle, onToggleAll }: MerchantCardProps) {
  const allIds = group.transactions.map((t) => t.id);
  const allSelected = allIds.every((id) => selected.has(id));
  const someSelected = allIds.some((id) => selected.has(id));

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-3 flex-wrap">
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = someSelected && !allSelected;
          }}
          onChange={(e) => onToggleAll(allIds, e.target.checked)}
          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          aria-label={`Select all transactions for ${group.merchant_name}`}
        />
        <span className="font-semibold text-gray-900">{group.merchant_name}</span>
        <div className="flex gap-1 flex-wrap">
          {group.categories.map((cat, i) => (
            <span
              key={cat}
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${categoryColor(i)}`}
            >
              {cat}
            </span>
          ))}
        </div>
        <span className="ml-auto text-xs text-gray-400">
          {group.transactions.length} transactions
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
              <th className="px-4 py-2 w-8"></th>
              <th className="px-4 py-2 text-left">Date</th>
              <th className="px-4 py-2 text-left">Description</th>
              <th className="px-4 py-2 text-right">Amount</th>
              <th className="px-4 py-2 text-left">Account</th>
              <th className="px-4 py-2 text-left">Category</th>
              <th className="px-4 py-2 text-left">Subcategory</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {group.transactions.map((tx) => (
              <tr
                key={tx.id}
                className={`hover:bg-gray-50 cursor-pointer ${selected.has(tx.id) ? "bg-indigo-50" : ""}`}
                onClick={() => onToggle(tx.id)}
              >
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(tx.id)}
                    onChange={() => onToggle(tx.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                </td>
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{tx.date}</td>
                <td className="px-4 py-2 text-gray-900 max-w-xs truncate">{tx.description}</td>
                <td className={`px-4 py-2 text-right font-mono ${amountColor(tx.amount)}`}>
                  {formatCurrency(tx.amount)}
                </td>
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{tx.account}</td>
                <td className="px-4 py-2 text-gray-700">{tx.category ?? "—"}</td>
                <td className="px-4 py-2 text-gray-500">{tx.subcategory ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function MixedCategoriesPage() {
  const [groups, setGroups] = useState<MixedCategoryMerchant[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [newCategory, setNewCategory] = useState("");
  const [newSubcategory, setNewSubcategory] = useState("");
  const [applying, setApplying] = useState(false);

  function loadGroups() {
    setLoading(true);
    getMixedCategoryMerchants()
      .then((res) => setGroups(res.groups))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadGroups();
  }, []);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(ids: number[], select: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (select ? next.add(id) : next.delete(id)));
      return next;
    });
  }

  function findTx(id: number): MixedCategoryTransaction | undefined {
    return groups?.flatMap((g) => g.transactions).find((t) => t.id === id);
  }

  async function handleApply() {
    if (!newCategory && !newSubcategory) return;
    setApplying(true);
    setError(null);
    try {
      await Promise.all(
        [...selected].map((id) => {
          const tx = findTx(id);
          if (!tx) return Promise.resolve();
          return updateTransaction(id, {
            description: tx.description,
            merchant_name: null,
            category: newCategory || tx.category,
            subcategory: newSubcategory || tx.subcategory,
            notes: null,
          });
        })
      );
      setSelected(new Set());
      setNewCategory("");
      setNewSubcategory("");
      loadGroups();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply changes");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto pb-32">
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900">Mixed Categories</h1>
          <HelpIcon section="mixed-categories" />
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Merchants whose transactions span multiple categories. Select transactions and apply a
          consistent category to resolve the inconsistency.
        </p>
        {groups && groups.length > 0 && (
          <p className="mt-1 text-sm font-medium text-amber-600">
            {groups.length} merchant{groups.length !== 1 ? "s" : ""} affected
          </p>
        )}
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
          <div className="text-sm font-medium">All merchants have consistent categories</div>
        </div>
      )}

      {groups && groups.length > 0 && (
        <div className="space-y-4">
          {groups.map((group) => (
            <MerchantCard
              key={group.merchant_id}
              group={group}
              selected={selected}
              onToggle={toggle}
              onToggleAll={toggleAll}
            />
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-10 bg-white border-t border-gray-200 shadow-lg px-4 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-gray-700">{selected.size} selected</span>
          <input
            type="text"
            placeholder="New category"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <input
            type="text"
            placeholder="New subcategory"
            value={newSubcategory}
            onChange={(e) => setNewSubcategory(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="button"
            onClick={handleApply}
            disabled={applying || (!newCategory && !newSubcategory)}
            className="px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {applying ? "Applying…" : "Apply"}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="px-3 py-1.5 text-sm font-medium text-gray-600 border border-gray-300 rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            Clear selection
          </button>
        </div>
      )}
    </div>
  );
}
