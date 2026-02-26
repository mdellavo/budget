import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import HelpIcon from "../components/HelpIcon";
import {
  listCategories,
  setCategoryClassification,
  setSubcategoryClassification,
} from "../api/client";
import type { CategoryFilters } from "../api/client";
import type { CategoryClassification, CategoryItem } from "../types";
import type { Data, Layout, Config } from "plotly.js";

// ── Types ──────────────────────────────────────────────────────────────────────

type SubSortKey = "total_amount" | "transaction_count" | "subcategory";

type CategoryGroup = {
  category: string;
  category_id: number | null;
  classification: CategoryClassification;
  total_amount: number;
  transaction_count: number;
  subcategories: CategoryItem[];
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatAmount(amount: string | number): { text: string; positive: boolean } {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return {
    text: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n),
    positive: n >= 0,
  };
}

const EMPTY_FILTERS = { date_from: "", date_to: "", category: "", subcategory: "" };
type FormFilters = typeof EMPTY_FILTERS;

const PALETTE = [
  "#3b82f6",
  "#f97316",
  "#a855f7",
  "#14b8a6",
  "#eab308",
  "#ec4899",
  "#6366f1",
  "#84cc16",
  "#ef4444",
  "#06b6d4",
  "#f59e0b",
  "#8b5cf6",
  "#f43f5e",
  "#22c55e",
  "#0ea5e9",
];

// ── CategoryDonutChart ─────────────────────────────────────────────────────────

function CategoryDonutChart({ subcategories }: { subcategories: CategoryItem[] }) {
  const divRef = useRef<HTMLDivElement>(null);

  const { trace, layout, config } = useMemo(() => {
    const trace: Data = {
      type: "pie",
      hole: 0.5,
      labels: subcategories.map((s) => s.subcategory),
      values: subcategories.map((s) => Math.abs(parseFloat(s.total_amount))),
      marker: { colors: subcategories.map((_, i) => PALETTE[i % PALETTE.length]) },
      hovertemplate: "%{label}<br><b>$%{value:,.2f}</b> (%{percent})<extra></extra>",
      textinfo: "percent",
      textposition: "inside",
      automargin: true,
    };

    const layout: Partial<Layout> = {
      showlegend: false,
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      margin: { l: 10, r: 10, t: 10, b: 10 },
    };

    const config: Partial<Config> = { responsive: true, displayModeBar: false };

    return { trace, layout, config };
  }, [subcategories]);

  useEffect(() => {
    if (!divRef.current) return;
    Plotly.react(divRef.current, [trace], layout, config);
  }, [trace, layout, config]);

  return <div ref={divRef} style={{ width: 240, height: 220 }} />;
}

// ── CategoryCard ───────────────────────────────────────────────────────────────

function ClassificationToggle({
  categoryId,
  classification,
  onChange,
}: {
  categoryId: number;
  classification: CategoryClassification;
  onChange: (id: number, c: CategoryClassification) => void;
}) {
  const btn = (label: string, value: CategoryClassification, activeClass: string) => {
    const isActive = classification === value;
    return (
      <button
        type="button"
        onClick={() => onChange(categoryId, isActive ? null : value)}
        className={`px-2 py-0.5 rounded-full text-xs font-medium border transition-colors ${
          isActive
            ? activeClass
            : "border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-600"
        }`}
      >
        {label}
      </button>
    );
  };
  return (
    <div className="flex items-center gap-1">
      {btn("Need", "need", "border-indigo-500 bg-indigo-100 text-indigo-700")}
      {btn("Want", "want", "border-amber-500 bg-amber-100 text-amber-700")}
      {classification !== null && (
        <button
          type="button"
          onClick={() => onChange(categoryId, null)}
          className="px-2 py-0.5 rounded-full text-xs font-medium border border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-600"
        >
          —
        </button>
      )}
    </div>
  );
}

function CategoryCard({
  group,
  subSortBy,
  onClassificationChange,
  onSubclassificationChange,
  subcategoryOverrides,
}: {
  group: CategoryGroup;
  subSortBy: SubSortKey;
  onClassificationChange: (id: number, c: CategoryClassification) => void;
  onSubclassificationChange: (id: number, c: CategoryClassification) => void;
  subcategoryOverrides: Record<number, CategoryClassification>;
}) {
  const sorted = useMemo(() => {
    return [...group.subcategories].sort((a, b) => {
      if (subSortBy === "total_amount") {
        return parseFloat(a.total_amount) - parseFloat(b.total_amount);
      }
      if (subSortBy === "transaction_count") {
        return a.transaction_count - b.transaction_count;
      }
      return a.subcategory.localeCompare(b.subcategory);
    });
  }, [group.subcategories, subSortBy]);

  const { text: totalText, positive } = formatAmount(group.total_amount);
  const isUncategorized = group.category === "Uncategorized";

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-gray-800">
            {isUncategorized ? (
              <Link
                to="/transactions?uncategorized=true"
                className="text-indigo-600 hover:underline italic"
              >
                Uncategorized
              </Link>
            ) : (
              <Link
                to={`/transactions?category=${encodeURIComponent(group.category)}`}
                className="text-indigo-600 hover:underline"
              >
                {group.category}
              </Link>
            )}
          </h2>
          {!isUncategorized && group.category_id != null && (
            <ClassificationToggle
              categoryId={group.category_id}
              classification={group.classification}
              onChange={onClassificationChange}
            />
          )}
        </div>
        <span
          className={`text-sm font-mono font-medium ${positive ? "text-green-600" : "text-red-600"}`}
        >
          Total: {totalText}
        </span>
      </div>

      {/* Card body: donut + table side-by-side */}
      <div className="flex items-start">
        {/* Donut chart */}
        <div className="flex-none p-3">
          <CategoryDonutChart subcategories={sorted} />
        </div>

        {/* Subcategory table */}
        <div className="flex-1 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Subcategory
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Txns
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Total Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map((sub, i) => {
                const { text, positive } = formatAmount(sub.total_amount);
                const isUncatSub = sub.subcategory === "Uncategorized";
                return (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-800">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full flex-none"
                          style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
                        />
                        {isUncatSub ? (
                          <Link
                            to="/transactions?uncategorized=true"
                            className="text-indigo-600 hover:underline italic"
                          >
                            Uncategorized
                          </Link>
                        ) : (
                          <Link
                            to={`/transactions?subcategory=${encodeURIComponent(sub.subcategory)}`}
                            className="text-indigo-600 hover:underline"
                          >
                            {sub.subcategory}
                          </Link>
                        )}
                        {sub.subcategory_id != null && !isUncatSub && (
                          <ClassificationToggle
                            categoryId={sub.subcategory_id}
                            classification={
                              sub.subcategory_id in subcategoryOverrides
                                ? subcategoryOverrides[sub.subcategory_id]
                                : sub.subcategory_classification
                            }
                            onChange={onSubclassificationChange}
                          />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right text-gray-600 tabular-nums">
                      {sub.transaction_count}
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-mono whitespace-nowrap ${positive ? "text-green-600" : "text-red-600"}`}
                    >
                      {text}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── CategoriesPage ─────────────────────────────────────────────────────────────

export default function CategoriesPage() {
  const [filters, setFilters] = useState<FormFilters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<FormFilters>(EMPTY_FILTERS);
  const [subSortBy, setSubSortBy] = useState<SubSortKey>("total_amount");
  const [rows, setRows] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRows = useCallback(async (formFilters: FormFilters) => {
    setLoading(true);
    setError(null);
    const apiFilters: CategoryFilters = { sort_by: "subcategory", sort_dir: "asc" };
    if (formFilters.date_from) apiFilters.date_from = formFilters.date_from;
    if (formFilters.date_to) apiFilters.date_to = formFilters.date_to;
    if (formFilters.category) apiFilters.category = formFilters.category;
    if (formFilters.subcategory) apiFilters.subcategory = formFilters.subcategory;
    try {
      const res = await listCategories(apiFilters);
      setRows(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load categories");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRows(appliedFilters);
  }, [appliedFilters, fetchRows]);

  const [classificationOverrides, setClassificationOverrides] = useState<
    Record<number, CategoryClassification>
  >({});
  const [subcategoryOverrides, setSubcategoryOverrides] = useState<
    Record<number, CategoryClassification>
  >({});

  async function handleClassificationChange(
    categoryId: number,
    classification: CategoryClassification
  ) {
    setClassificationOverrides((prev) => ({ ...prev, [categoryId]: classification }));
    try {
      await setCategoryClassification(categoryId, classification);
    } catch {
      // revert on failure
      setClassificationOverrides((prev) => {
        const next = { ...prev };
        delete next[categoryId];
        return next;
      });
    }
  }

  async function handleSubclassificationChange(
    subcategoryId: number,
    classification: CategoryClassification
  ) {
    setSubcategoryOverrides((prev) => ({ ...prev, [subcategoryId]: classification }));
    try {
      await setSubcategoryClassification(subcategoryId, classification);
    } catch {
      // revert on failure
      setSubcategoryOverrides((prev) => {
        const next = { ...prev };
        delete next[subcategoryId];
        return next;
      });
    }
  }

  const groups = useMemo<CategoryGroup[]>(() => {
    const map = new Map<string, CategoryGroup>();
    for (const row of rows) {
      const key = row.category_id != null ? String(row.category_id) : row.category;
      const existing = map.get(key);
      if (existing) {
        existing.subcategories.push(row);
        existing.total_amount += parseFloat(row.total_amount);
        existing.transaction_count += row.transaction_count;
      } else {
        const baseClassification = row.classification;
        const classification =
          row.category_id != null && row.category_id in classificationOverrides
            ? classificationOverrides[row.category_id]
            : baseClassification;
        map.set(key, {
          category: row.category,
          category_id: row.category_id,
          classification,
          total_amount: parseFloat(row.total_amount),
          transaction_count: row.transaction_count,
          subcategories: [row],
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      const aUncat = a.category === "Uncategorized";
      const bUncat = b.category === "Uncategorized";
      if (aUncat && !bUncat) return 1;
      if (!aUncat && bUncat) return -1;
      return Math.abs(b.total_amount) - Math.abs(a.total_amount);
    });
  }, [rows, classificationOverrides]);

  function handleApply(e: React.FormEvent) {
    e.preventDefault();
    setAppliedFilters(filters);
  }

  function handleClear() {
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
  }

  return (
    <div className="p-8">
      <div className="flex items-center gap-2 mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Categories</h1>
        <HelpIcon section="categories" />
      </div>

      {/* Filter bar */}
      <form
        onSubmit={handleApply}
        className="mb-6 bg-white border border-gray-200 rounded-md shadow-sm p-4"
      >
        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Date From</label>
            <input
              type="date"
              value={filters.date_from}
              onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value }))}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Date To</label>
            <input
              type="date"
              value={filters.date_to}
              onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Category</label>
            <input
              type="text"
              value={filters.category}
              onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
              placeholder="e.g. Food"
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Subcategory</label>
            <input
              type="text"
              value={filters.subcategory}
              onChange={(e) => setFilters((f) => ({ ...f, subcategory: e.target.value }))}
              placeholder="e.g. Groceries"
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Sort subcategories by</label>
            <select
              value={subSortBy}
              onChange={(e) => setSubSortBy(e.target.value as SubSortKey)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              <option value="total_amount">Total Amount</option>
              <option value="transaction_count">Transaction Count</option>
              <option value="subcategory">Name</option>
            </select>
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

      {/* Loading state */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400 gap-2">
          <svg
            className="animate-spin h-5 w-5 text-indigo-500"
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
      ) : groups.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400">No categories found.</div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <CategoryCard
              key={group.category}
              group={group}
              subSortBy={subSortBy}
              onClassificationChange={handleClassificationChange}
              onSubclassificationChange={handleSubclassificationChange}
              subcategoryOverrides={subcategoryOverrides}
            />
          ))}
        </div>
      )}
    </div>
  );
}
