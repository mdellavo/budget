import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getRecurring, getRecurringSummary } from "../api/client";
import HelpIcon from "../components/HelpIcon";
import AiSummaryCard from "../components/AiSummaryCard";
import MerchantLogo from "../components/MerchantLogo";
import { parseAmount } from "../lib/format";
import type { RecurringItem, ReportSummary } from "../types";

const TODAY = new Date().toISOString().slice(0, 10);

function defaultDateRange(): { date_from: string; date_to: string } {
  const today = new Date();
  const date_to = today.toISOString().slice(0, 10);
  const from = new Date(today);
  from.setMonth(from.getMonth() - 6);
  const date_from = from.toISOString().slice(0, 10);
  return { date_from, date_to };
}

type SortKey = keyof RecurringItem;

const COLUMNS: { label: string; key: SortKey; rightAlign?: boolean }[] = [
  { label: "Merchant", key: "merchant" },
  { label: "Category", key: "category" },
  { label: "Typical Amount", key: "amount", rightAlign: true },
  { label: "Frequency", key: "frequency" },
  { label: "/month", key: "monthly_cost", rightAlign: true },
  { label: "Occurrences", key: "occurrences", rightAlign: true },
  { label: "Last Charge", key: "last_charge" },
  { label: "Est. Next", key: "next_estimated" },
];

const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function formatCurrency(amount: string) {
  return fmt.format(parseFloat(amount));
}

function formatAmount(n: number) {
  return fmt.format(n);
}

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString();
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function compareValues(a: RecurringItem, b: RecurringItem, key: SortKey): number {
  const av = a[key];
  const bv = b[key];
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  if (key === "amount" || key === "monthly_cost") {
    return Math.abs(parseAmount(av as string)) - Math.abs(parseAmount(bv as string));
  }
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  return String(av).localeCompare(String(bv));
}

export default function RecurringPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const defaults = defaultDateRange();
  const activeFrom = searchParams.get("date_from") ?? defaults.date_from;
  const activeTo = searchParams.get("date_to") ?? defaults.date_to;

  const [dateFrom, setDateFrom] = useState(activeFrom);
  const [dateTo, setDateTo] = useState(activeTo);
  const [items, setItems] = useState<RecurringItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("merchant");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [aiSummary, setAiSummary] = useState<ReportSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDateFrom(activeFrom);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDateTo(activeTo);
  }, [activeFrom, activeTo]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    getRecurring({ date_from: activeFrom, date_to: activeTo })
      .then((data) => setItems(data.items.filter((item) => item.category !== "Income")))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [activeFrom, activeTo]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAiSummary(null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSummaryLoading(true);
    getRecurringSummary({ date_from: activeFrom, date_to: activeTo })
      .then(setAiSummary)
      .catch(() => {})
      .finally(() => setSummaryLoading(false));
  }, [activeFrom, activeTo]);

  const handleRegenerateSummary = useCallback(() => {
    setAiSummary(null);
    setSummaryLoading(true);
    getRecurringSummary({ date_from: activeFrom, date_to: activeTo }, true)
      .then(setAiSummary)
      .catch(() => {})
      .finally(() => setSummaryLoading(false));
  }, [activeFrom, activeTo]);

  function handleApply(e: React.FormEvent) {
    e.preventDefault();
    setSearchParams({ date_from: dateFrom, date_to: dateTo });
  }

  function handleSort(key: SortKey) {
    if (key === sortBy) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("asc");
    }
  }

  const sorted = useMemo(() => {
    if (!items) return items;
    return [...items].sort((a, b) => {
      const cmp = compareValues(a, b, sortBy);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [items, sortBy, sortDir]);

  const summary = useMemo(() => {
    if (!items || items.length === 0) return null;
    const monthly = items.reduce((sum, item) => sum + parseAmount(item.monthly_cost), 0);
    return { count: items.length, monthly, quarterly: monthly * 3, annual: monthly * 12 };
  }, [items]);

  const categoryBreakdown = useMemo(() => {
    if (!items || items.length === 0) return null;
    const catMap = new Map<
      string,
      { monthly: number; count: number; subs: Map<string, { monthly: number; count: number }> }
    >();
    for (const item of items) {
      const cat = item.category ?? "Uncategorized";
      const sub = item.subcategory ?? "—";
      const cost = parseAmount(item.monthly_cost);
      if (!catMap.has(cat)) catMap.set(cat, { monthly: 0, count: 0, subs: new Map() });
      const catEntry = catMap.get(cat)!;
      catEntry.monthly += cost;
      catEntry.count += 1;
      if (!catEntry.subs.has(sub)) catEntry.subs.set(sub, { monthly: 0, count: 0 });
      const subEntry = catEntry.subs.get(sub)!;
      subEntry.monthly += cost;
      subEntry.count += 1;
    }
    return [...catMap.entries()]
      .sort(([, a], [, b]) => b.monthly - a.monthly)
      .map(([cat, { monthly, count, subs }]) => ({
        category: cat,
        monthly,
        count,
        subcategories: [...subs.entries()]
          .sort(([, a], [, b]) => b.monthly - a.monthly)
          .map(([sub, vals]) => ({ subcategory: sub, ...vals })),
      }));
  }, [items]);

  return (
    <div className="p-8">
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-2xl font-bold text-gray-900">Recurring Charges</h1>
        <HelpIcon section="recurring" />
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Subscriptions and bills detected automatically from your transaction history.
      </p>

      <form onSubmit={handleApply} className="flex items-end gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1" htmlFor="date-from">
            From
          </label>
          <input
            id="date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1" htmlFor="date-to">
            To
          </label>
          <input
            id="date-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Apply
        </button>
      </form>

      {loading && <div className="text-gray-500">Loading…</div>}

      {error && (
        <div className="text-red-600 bg-red-50 border border-red-200 rounded p-4">{error}</div>
      )}

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {(
            [
              { label: "Monthly", value: formatAmount(summary.monthly) },
              { label: "Quarterly", value: formatAmount(summary.quarterly) },
              { label: "Annual", value: formatAmount(summary.annual) },
              { label: "Subscriptions", value: String(summary.count) },
            ] as const
          ).map(({ label, value }) => (
            <div key={label} className="bg-white border border-gray-200 rounded-lg p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
              <p className="text-xl font-bold text-gray-900">{value}</p>
            </div>
          ))}
        </div>
      )}

      {(summaryLoading || aiSummary) && (
        <AiSummaryCard
          summary={aiSummary}
          loading={summaryLoading}
          onRegenerate={handleRegenerateSummary}
          className="mb-6"
        />
      )}

      {categoryBreakdown && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-6">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Category / Subcategory
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">
                  /month
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Annual
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Count
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {categoryBreakdown.map(({ category, monthly, count, subcategories }) => (
                <>
                  <tr key={category} className="bg-gray-50">
                    <td className="px-4 py-2 font-semibold text-gray-800">
                      <Link
                        to={`/transactions?category=${encodeURIComponent(category)}&is_recurring=true`}
                        className="text-indigo-600 hover:underline"
                      >
                        {category}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-gray-800">
                      {formatAmount(monthly)}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-gray-800">
                      {formatAmount(monthly * 12)}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500">{count}</td>
                  </tr>
                  {subcategories.map(({ subcategory, monthly: subMonthly, count: subCount }) => (
                    <tr key={`${category}-${subcategory}`}>
                      <td className="px-4 py-1.5 pl-8 text-gray-600">
                        <Link
                          to={`/transactions?subcategory=${encodeURIComponent(subcategory)}&is_recurring=true`}
                          className="text-indigo-600 hover:underline"
                        >
                          {subcategory}
                        </Link>
                      </td>
                      <td className="px-4 py-1.5 text-right text-gray-600">
                        {formatAmount(subMonthly)}
                      </td>
                      <td className="px-4 py-1.5 text-right text-gray-600">
                        {formatAmount(subMonthly * 12)}
                      </td>
                      <td className="px-4 py-1.5 text-right text-gray-500">{subCount}</td>
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sorted && sorted.length === 0 && (
        <div className="text-gray-500">No recurring charges detected.</div>
      )}

      {sorted && sorted.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {COLUMNS.map(({ label, key, rightAlign }) => (
                  <th
                    key={key}
                    className={`px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide ${rightAlign ? "text-right" : "text-left"}`}
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
              {sorted.map((item, i) => {
                const isOverdue = item.next_estimated < TODAY;
                return (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <div className="flex items-center gap-2">
                        <MerchantLogo website={item.website} name={item.merchant} />
                        <Link
                          to={`/transactions?merchant=${encodeURIComponent(item.merchant)}`}
                          className="text-indigo-600 hover:underline"
                        >
                          {item.merchant}
                        </Link>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{item.category ?? "—"}</td>
                    <td className="px-4 py-3 text-right text-gray-900">
                      {formatCurrency(item.amount)}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{capitalize(item.frequency)}</td>
                    <td className="px-4 py-3 text-right text-gray-900">
                      {formatCurrency(item.monthly_cost)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">{item.occurrences}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(item.last_charge)}</td>
                    <td
                      className={`px-4 py-3 ${isOverdue ? "text-red-600 font-bold" : "text-gray-600"}`}
                    >
                      {formatDate(item.next_estimated)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
