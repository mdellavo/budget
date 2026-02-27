import { useState, useEffect, useRef, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getOverview, listMonths } from "../api/client";
import HelpIcon from "../components/HelpIcon";
import type { OverviewData, SankeyNode } from "../types";
import type { Data, Layout, Config } from "plotly.js";

function formatCurrency(amount: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    parseFloat(amount)
  );
}

function monthToDateFrom(m: string): string {
  return m + "-01";
}

function monthToDateTo(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo, 0).toISOString().slice(0, 10);
}

function formatMonthLabel(m: string): string {
  const [year, month] = m.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function nowYYYYMM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function budgetLink(w: { scope: "category" | "subcategory"; name: string }): string {
  const yyyymm = nowYYYYMM();
  const p = new URLSearchParams({
    date_from: monthToDateFrom(yyyymm),
    date_to: monthToDateTo(yyyymm),
    [w.scope === "category" ? "category" : "subcategory"]: w.name,
  });
  return `/transactions?${p.toString()}`;
}

type Preset = "all" | "mtd" | "ytd" | null;

export default function OverviewPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [months, setMonths] = useState<string[]>([]);

  // Filter state lives in the URL so the back button restores it.
  const fromMonth = searchParams.get("from") ?? "";
  const toMonth = searchParams.get("to") ?? "";

  // Derive the active preset from the URL params rather than keeping it in state.
  const yyyymm = nowYYYYMM();
  const preset: Preset = (() => {
    if (!fromMonth && !toMonth) return "all";
    if (fromMonth === yyyymm && toMonth === yyyymm) return "mtd";
    if (fromMonth === `${yyyymm.slice(0, 4)}-01` && toMonth === yyyymm) return "ytd";
    return null;
  })();

  useEffect(() => {
    listMonths()
      .then((res) => setMonths(res.months))
      .catch(() => {});
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    const date_from = fromMonth ? monthToDateFrom(fromMonth) : undefined;
    const date_to = toMonth ? monthToDateTo(toMonth) : undefined;
    getOverview({ date_from, date_to })
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [fromMonth, toMonth]);

  // Replace the current history entry so filter tweaks don't litter the stack.
  // Navigation away (clicking a category) pushes a new entry on top, so the
  // back button returns here with the URL — and thus the filters — intact.
  function applyPreset(p: Preset) {
    const cur = nowYYYYMM();
    const year = cur.slice(0, 4);
    if (p === "all") {
      setSearchParams({}, { replace: true });
    } else if (p === "mtd") {
      setSearchParams({ from: cur, to: cur }, { replace: true });
    } else if (p === "ytd") {
      setSearchParams({ from: `${year}-01`, to: cur }, { replace: true });
    }
  }

  const chartDateFrom = fromMonth ? monthToDateFrom(fromMonth) : undefined;
  const chartDateTo = toMonth ? monthToDateTo(toMonth) : undefined;

  function categoryUrl(name: string): string {
    const p = new URLSearchParams();
    if (chartDateFrom) p.set("date_from", chartDateFrom);
    if (chartDateTo) p.set("date_to", chartDateTo);
    p.set("category", name);
    return `/transactions?${p.toString()}`;
  }

  return (
    <div className="p-8">
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-2xl font-bold text-gray-900">Overview</h1>
        <HelpIcon section="overview" />
      </div>
      <p className="text-sm text-gray-500 mb-6">
        A high-level snapshot of your income, expenses, and savings.
      </p>

      {/* Date filter bar */}
      <div className="mb-6 space-y-3">
        <div className="flex gap-2">
          {(["all", "mtd", "ytd"] as const).map((p) => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                preset === p
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-gray-700 border-gray-300 hover:border-indigo-400"
              }`}
            >
              {p === "all" ? "All time" : p === "mtd" ? "Month to date" : "Year to date"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">From</label>
            <select
              value={fromMonth}
              onChange={(e) => {
                const params: Record<string, string> = {};
                if (e.target.value) params.from = e.target.value;
                if (toMonth) params.to = toMonth;
                setSearchParams(params, { replace: true });
              }}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            >
              <option value="">All time</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {formatMonthLabel(m)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">To</label>
            <select
              value={toMonth}
              onChange={(e) => {
                const params: Record<string, string> = {};
                if (fromMonth) params.from = fromMonth;
                if (e.target.value) params.to = e.target.value;
                setSearchParams(params, { replace: true });
              }}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            >
              <option value="">All time</option>
              {months
                .filter((m) => !fromMonth || m >= fromMonth)
                .map((m) => (
                  <option key={m} value={m}>
                    {formatMonthLabel(m)}
                  </option>
                ))}
            </select>
          </div>
        </div>
      </div>

      {loading && <div className="text-gray-500">Loading…</div>}

      {error && (
        <div className="text-red-600 bg-red-50 border border-red-200 rounded p-4">{error}</div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <StatCard
              label="Total Transactions"
              value={data.transaction_count.toLocaleString()}
              colorClass="text-gray-900"
            />
            <StatCard
              label="Income"
              value={formatCurrency(data.income)}
              colorClass="text-green-600"
            />
            <StatCard
              label="Expenses"
              value={formatCurrency(data.expenses)}
              colorClass="text-red-600"
            />
            <StatCard
              label="Net Change"
              value={formatCurrency(data.net)}
              colorClass={parseFloat(data.net) >= 0 ? "text-green-600" : "text-red-600"}
            />
            <StatCard
              label="Savings Rate"
              value={data.savings_rate !== null ? `${data.savings_rate.toFixed(1)}%` : "—"}
              colorClass={
                data.savings_rate !== null && data.savings_rate > 0
                  ? "text-green-600"
                  : "text-gray-400"
              }
            />
          </div>

          {data.budget_warnings.length > 0 && preset === "mtd" && (
            <div className="mt-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-3">Budget Alerts</h2>
              <div className="space-y-2">
                {data.budget_warnings.map((w) => (
                  <div
                    key={w.id}
                    className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
                      w.severity === "over"
                        ? "border-red-200 bg-red-50"
                        : "border-amber-200 bg-amber-50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`text-sm font-medium ${w.severity === "over" ? "text-red-700" : "text-amber-700"}`}
                      >
                        {w.severity === "over" ? "Over budget" : "Approaching limit"}
                      </span>
                      <span className="text-sm text-gray-700">{w.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`text-sm font-semibold ${w.severity === "over" ? "text-red-600" : "text-amber-600"}`}
                      >
                        {formatCurrency(w.spent)} / {formatCurrency(w.amount_limit)} ({w.pct}%)
                      </span>
                      <Link
                        to={budgetLink(w)}
                        className="text-sm text-indigo-600 hover:underline whitespace-nowrap"
                      >
                        View →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
              <Link
                to="/budgets"
                className="mt-2 inline-block text-sm text-indigo-600 hover:underline"
              >
                Manage budgets →
              </Link>
            </div>
          )}

          {data.sankey.income_sources.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg font-semibold text-gray-800 mb-1">Money Flow</h2>
              <p className="text-xs text-gray-500 mb-4">Click a node to view its transactions</p>
              <SankeyChart
                incomeSources={data.sankey.income_sources}
                expenseCategories={data.sankey.expense_categories}
                net={data.net}
                totalIncome={data.income}
                dateFrom={chartDateFrom}
                dateTo={chartDateTo}
              />
              <details className="mt-4 text-sm text-gray-600">
                <summary className="cursor-pointer font-medium text-gray-700 hover:text-gray-900">
                  How to read this diagram
                </summary>
                <ul className="mt-2 ml-4 list-disc space-y-1">
                  <li>Band width represents dollar amount — thicker = more money</li>
                  <li>
                    Left: your income sources; Middle: total income pooled; Right: where it went
                  </li>
                  <li>Hover over any band or node for exact amounts and percentages</li>
                  <li>Savings (green, far right) = income minus all expenses</li>
                </ul>
              </details>
            </div>
          )}

          {data.expense_breakdown.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg font-semibold text-gray-800 mb-1">Spending by Category</h2>
              <p className="text-xs text-gray-500 mb-4">Click a slice to view its transactions</p>
              <DonutChart
                categories={data.expense_breakdown}
                totalExpenses={data.expenses}
                dateFrom={chartDateFrom}
                dateTo={chartDateTo}
              />
            </div>
          )}

          {(data.income_breakdown.length > 0 || data.expense_breakdown.length > 0) && (
            <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
              {data.income_breakdown.length > 0 && (
                <div>
                  <h2 className="text-lg font-semibold text-gray-800 mb-3">Income by Category</h2>
                  <div className="overflow-hidden rounded-lg border border-gray-200">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                            Category
                          </th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {data.income_breakdown.map((row) => (
                          <tr key={row.name} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-sm">
                              <Link
                                to={categoryUrl(row.name)}
                                className="text-indigo-600 hover:underline"
                              >
                                {row.name}
                              </Link>
                            </td>
                            <td className="px-4 py-2 text-sm text-right text-green-600 font-medium">
                              {formatCurrency(row.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {data.expense_breakdown.length > 0 && (
                <div>
                  <h2 className="text-lg font-semibold text-gray-800 mb-3">Expenses by Category</h2>
                  <div className="overflow-hidden rounded-lg border border-gray-200">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                            Category
                          </th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {data.expense_breakdown.map((row) => (
                          <tr key={row.name} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-sm">
                              <Link
                                to={categoryUrl(row.name)}
                                className="text-indigo-600 hover:underline"
                              >
                                {row.name}
                              </Link>
                            </td>
                            <td className="px-4 py-2 text-sm text-right text-red-600 font-medium">
                              {formatCurrency(row.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: string;
  colorClass: string;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">{label}</p>
      <p className={`text-2xl font-bold ${colorClass}`}>{value}</p>
    </div>
  );
}

interface SankeyChartProps {
  incomeSources: SankeyNode[];
  expenseCategories: SankeyNode[];
  net: string;
  totalIncome: string;
  dateFrom?: string;
  dateTo?: string;
}

function SankeyChart({
  incomeSources,
  expenseCategories,
  net,
  totalIncome,
  dateFrom,
  dateTo,
}: SankeyChartProps) {
  const navigate = useNavigate();
  const divRef = useRef<HTMLDivElement>(null);
  const netValue = parseFloat(net);
  const totalIncomeValue = parseFloat(totalIncome);

  // Bundle everything the effect needs into one memo so render + click-bind
  // always happen in the same effect execution.
  const chartBundle = useMemo(() => {
    const I = incomeSources.length;
    const E = expenseCategories.length;
    const hasSavings = netValue > 0;

    const nodeLabels: string[] = [
      ...incomeSources.map((s) => s.name),
      "Total Income",
      ...expenseCategories.map((c) => c.name),
      ...(hasSavings ? ["Savings"] : []),
    ];
    const nodeColors: string[] = [
      ...incomeSources.map(() => "#22c55e"),
      "#3b82f6",
      ...expenseCategories.map(() => "#f97316"),
      ...(hasSavings ? ["#22c55e"] : []),
    ];
    const linkSources: number[] = [];
    const linkTargets: number[] = [];
    const linkValues: number[] = [];
    const linkColors: string[] = [];
    const linkCustomdata: number[] = [];

    for (let i = 0; i < incomeSources.length; i++) {
      const value = parseFloat(incomeSources[i].amount);
      if (value <= 0) continue;
      linkSources.push(i);
      linkTargets.push(I);
      linkValues.push(value);
      linkColors.push("rgba(34,197,94,0.3)");
      linkCustomdata.push(totalIncomeValue > 0 ? (value / totalIncomeValue) * 100 : 0);
    }
    for (let j = 0; j < expenseCategories.length; j++) {
      const value = Math.abs(parseFloat(expenseCategories[j].amount));
      if (value <= 0) continue;
      linkSources.push(I);
      linkTargets.push(I + 1 + j);
      linkValues.push(value);
      linkColors.push("rgba(249,115,22,0.3)");
      linkCustomdata.push(totalIncomeValue > 0 ? (value / totalIncomeValue) * 100 : 0);
    }
    if (hasSavings) {
      linkSources.push(I);
      linkTargets.push(I + E + 1);
      linkValues.push(netValue);
      linkColors.push("rgba(34,197,94,0.3)");
      linkCustomdata.push(totalIncomeValue > 0 ? (netValue / totalIncomeValue) * 100 : 0);
    }

    return {
      nodeLabels,
      nodeColors,
      linkSources,
      linkTargets,
      linkValues,
      linkColors,
      linkCustomdata,
      incomeSourceNames: new Set(incomeSources.map((s) => s.name)),
      expenseCatNames: new Set(expenseCategories.map((c) => c.name)),
    };
  }, [incomeSources, expenseCategories, netValue, totalIncomeValue]);

  // Single effect: render then bind — guarantees the emitter exists when we call .on()
  useEffect(() => {
    if (!divRef.current) return;
    const el = divRef.current;

    const {
      nodeLabels,
      nodeColors,
      linkSources,
      linkTargets,
      linkValues,
      linkColors,
      linkCustomdata,
      incomeSourceNames,
      expenseCatNames,
    } = chartBundle;

    const trace: Data = {
      type: "sankey",
      orientation: "h",
      node: { label: nodeLabels, color: nodeColors, pad: 20, thickness: 20 },
      link: {
        source: linkSources,
        target: linkTargets,
        value: linkValues,
        color: linkColors,
        customdata: linkCustomdata,
        hovertemplate:
          "%{source.label} → %{target.label}<br>$%{value:,.2f} (%{customdata:.1f}%)<extra></extra>",
      },
    };
    const layout: Partial<Layout> = {
      font: { size: 12 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      margin: { l: 0, r: 0, t: 40, b: 0 },
    };
    const config: Partial<Config> = { responsive: true, displayModeBar: false };

    Plotly.react(el, [trace], layout, config);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function handleClick(eventData: any) {
      const label: string = eventData?.points?.[0]?.label ?? "";
      if (!label) return;

      const p = new URLSearchParams();
      if (dateFrom) p.set("date_from", dateFrom);
      if (dateTo) p.set("date_to", dateTo);

      if (incomeSourceNames.has(label) && label !== "Other Income") {
        p.set("merchant", label);
        navigate(`/transactions?${p}`);
      } else if (label === "Other Income" || label === "Total Income") {
        p.set("amount_min", "0.01");
        navigate(`/transactions?${p}`);
      } else if (expenseCatNames.has(label) && label !== "Other Expenses") {
        p.set("category", label);
        navigate(`/transactions?${p}`);
      } else if (label === "Other Expenses") {
        p.set("amount_max", "-0.01");
        navigate(`/transactions?${p}`);
      }
      // "Savings" — no navigation
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).on("plotly_click", handleClick);
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).removeListener("plotly_click", handleClick);
    };
  }, [chartBundle, navigate, dateFrom, dateTo]);

  return <div ref={divRef} style={{ width: "100%", height: 800, cursor: "pointer" }} />;
}

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

interface DonutChartProps {
  categories: SankeyNode[];
  totalExpenses: string;
  dateFrom?: string;
  dateTo?: string;
}

function DonutChart({ categories, dateFrom, dateTo }: DonutChartProps) {
  const navigate = useNavigate();
  const divRef = useRef<HTMLDivElement>(null);

  const { trace, layout, config } = useMemo(() => {
    const trace: Data = {
      type: "pie",
      hole: 0.4,
      labels: categories.map((c) => c.name),
      values: categories.map((c) => Math.abs(parseFloat(c.amount))),
      marker: { colors: categories.map((_, i) => PALETTE[i % PALETTE.length]) },
      hovertemplate: "%{label}<br><b>$%{value:,.2f}</b> (%{percent})<extra></extra>",
      textinfo: "percent",
      textposition: "inside",
      automargin: true,
    };
    const layout: Partial<Layout> = {
      showlegend: true,
      legend: { orientation: "v", x: 1.02, xanchor: "left", y: 0.5 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      margin: { l: 20, r: 200, t: 20, b: 20 },
    };
    const config: Partial<Config> = { responsive: true, displayModeBar: false };
    return { trace, layout, config };
  }, [categories]);

  // Single effect: render then bind — guarantees the emitter exists when we call .on()
  useEffect(() => {
    if (!divRef.current) return;
    const el = divRef.current;

    Plotly.react(el, [trace], layout, config);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function handleClick(eventData: any) {
      const label: string = eventData?.points?.[0]?.label ?? "";
      if (!label) return;

      const p = new URLSearchParams();
      if (dateFrom) p.set("date_from", dateFrom);
      if (dateTo) p.set("date_to", dateTo);
      p.set("category", label);
      navigate(`/transactions?${p}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).on("plotly_click", handleClick);
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).removeListener("plotly_click", handleClick);
    };
  }, [trace, layout, config, navigate, dateFrom, dateTo]);

  return <div ref={divRef} style={{ width: "100%", height: 460, cursor: "pointer" }} />;
}
