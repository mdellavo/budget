import { useState, useEffect, useRef, useMemo } from "react";
import { Link } from "react-router-dom";
import { getOverview } from "../api/client";
import HelpIcon from "../components/HelpIcon";
import type { OverviewData, SankeyNode } from "../types";
import type { Data, Layout, Config } from "plotly.js";

function formatCurrency(amount: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    parseFloat(amount)
  );
}

export default function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOverview()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-8">
      <div className="flex items-center gap-2 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Overview</h1>
        <HelpIcon section="overview" />
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

          {data.budget_warnings.length > 0 && (
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
                    <span
                      className={`text-sm font-semibold ${w.severity === "over" ? "text-red-600" : "text-amber-600"}`}
                    >
                      {formatCurrency(w.spent)} / {formatCurrency(w.amount_limit)} ({w.pct}%)
                    </span>
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
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Money Flow</h2>
              <SankeyChart
                incomeSources={data.sankey.income_sources}
                expenseCategories={data.sankey.expense_categories}
                net={data.net}
                totalIncome={data.income}
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
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Spending by Category</h2>
              <DonutChart categories={data.expense_breakdown} totalExpenses={data.expenses} />
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
}

function SankeyChart({ incomeSources, expenseCategories, net, totalIncome }: SankeyChartProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const netValue = parseFloat(net);
  const totalIncomeValue = parseFloat(totalIncome);

  const {
    nodeLabels,
    nodeColors,
    linkSources,
    linkTargets,
    linkValues,
    linkColors,
    linkCustomdata,
  } = useMemo(() => {
    const I = incomeSources.length;
    const E = expenseCategories.length;
    const hasSavings = netValue > 0;

    // Node indices:
    // 0..I-1        income source nodes
    // I             "Total Income"
    // I+1..I+E      expense category nodes
    // I+E+1         "Savings" (only if net > 0)

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

    // Income source → Total Income links
    for (let i = 0; i < incomeSources.length; i++) {
      const value = parseFloat(incomeSources[i].amount);
      if (value <= 0) continue;
      linkSources.push(i);
      linkTargets.push(I);
      linkValues.push(value);
      linkColors.push("rgba(34,197,94,0.3)");
      linkCustomdata.push(totalIncomeValue > 0 ? (value / totalIncomeValue) * 100 : 0);
    }

    // Total Income → expense category links
    for (let j = 0; j < expenseCategories.length; j++) {
      const value = Math.abs(parseFloat(expenseCategories[j].amount));
      if (value <= 0) continue;
      linkSources.push(I);
      linkTargets.push(I + 1 + j);
      linkValues.push(value);
      linkColors.push("rgba(249,115,22,0.3)");
      linkCustomdata.push(totalIncomeValue > 0 ? (value / totalIncomeValue) * 100 : 0);
    }

    // Total Income → Savings link
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
    };
  }, [incomeSources, expenseCategories, netValue, totalIncomeValue]);

  useEffect(() => {
    if (!divRef.current) return;

    const trace: Data = {
      type: "sankey",
      orientation: "h",
      node: {
        label: nodeLabels,
        color: nodeColors,
        pad: 20,
        thickness: 20,
      },
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

    const config: Partial<Config> = {
      responsive: true,
      displayModeBar: false,
    };

    Plotly.react(divRef.current, [trace], layout, config);
  }, [nodeLabels, nodeColors, linkSources, linkTargets, linkValues, linkColors, linkCustomdata]);

  return <div ref={divRef} style={{ width: "100%", height: 800 }} />;
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
}

function DonutChart({ categories }: DonutChartProps) {
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

  useEffect(() => {
    if (!divRef.current) return;
    Plotly.react(divRef.current, [trace], layout, config);
  }, [trace, layout, config]);

  return <div ref={divRef} style={{ width: "100%", height: 460 }} />;
}
