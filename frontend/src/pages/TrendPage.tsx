import { useEffect, useMemo, useRef, useState } from "react";
import { getCategoryTrends } from "../api/client";
import type { CategoryTrendFilters } from "../api/client";
import type { CategoryTrendItem } from "../types";
import type { Data, Layout, Config } from "plotly.js";

declare const Plotly: {
  react: (el: HTMLElement, data: Data[], layout: Partial<Layout>, config?: Partial<Config>) => void;
};

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

function defaultDateRange(): { date_from: string; date_to: string } {
  const now = new Date();
  const date_to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const from = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const date_from = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}`;
  return { date_from, date_to };
}

export default function TrendPage() {
  const defaults = defaultDateRange();
  const [dateFrom, setDateFrom] = useState(defaults.date_from);
  const [dateTo, setDateTo] = useState(defaults.date_to);
  const [appliedFilters, setAppliedFilters] = useState<CategoryTrendFilters>({
    date_from: defaults.date_from,
    date_to: defaults.date_to,
  });
  const [items, setItems] = useState<CategoryTrendItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    getCategoryTrends(appliedFilters)
      .then((data) => setItems(data.items))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [appliedFilters]);

  const { traces, layout } = useMemo(() => {
    const months = Array.from(new Set(items.map((i) => i.month))).sort();
    const categories = Array.from(new Set(items.map((i) => i.category))).sort();

    const traces: Data[] = categories.map((cat, idx) => ({
      x: months,
      y: months.map((m) => {
        const row = items.find((i) => i.month === m && i.category === cat);
        return row ? Math.abs(parseFloat(row.total)) : 0;
      }),
      name: cat,
      type: "scatter",
      mode: "lines+markers",
      marker: { color: PALETTE[idx % PALETTE.length], size: 6 },
      line: { width: 2 },
    }));

    const layout: Partial<Layout> = {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      margin: { t: 20, r: 20, b: 80, l: 80 },
      xaxis: { title: { text: "Month" }, tickangle: -45 },
      yaxis: { title: { text: "Expenses ($)" }, tickformat: "$,.0f" },
      showlegend: true,
      legend: { x: 1.02, xanchor: "left", y: 1 },
    };

    return { traces, layout };
  }, [items]);

  useEffect(() => {
    if (!divRef.current || traces.length === 0) return;
    Plotly.react(divRef.current, traces, layout, { responsive: true, displayModeBar: false });
  }, [traces, layout]);

  function handleApply(e: React.FormEvent) {
    e.preventDefault();
    setAppliedFilters({ date_from: dateFrom, date_to: dateTo });
  }

  return (
    <div className="p-8">
      <div className="max-w-5xl space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Trends</h1>

        {/* Filter bar */}
        <form onSubmit={handleApply} className="flex items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1" htmlFor="date-from">
              Month from
            </label>
            <input
              id="date-from"
              type="month"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1" htmlFor="date-to">
              Month to
            </label>
            <input
              id="date-to"
              type="month"
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

        {/* Status / chart */}
        {error && (
          <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {loading && <p className="text-sm text-gray-500">Loading…</p>}

        {!loading && !error && items.length === 0 && (
          <p className="text-sm text-gray-500">No expense data for the selected period.</p>
        )}

        {!loading && !error && items.length > 0 && (
          <div ref={divRef} style={{ width: "100%", height: 480 }} />
        )}
      </div>
    </div>
  );
}
