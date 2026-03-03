import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AiSummaryCard from "../components/AiSummaryCard";
import HelpIcon from "../components/HelpIcon";
import SpendingChart from "../components/SpendingChart";
import { listMonths, getMonthlyReport, getMonthlyReportSummary } from "../api/client";
import { formatCurrency, amountColor } from "../lib/format";
import type { MonthlyReport, ReportSummary } from "../types";

function formatMonth(ym: string): string {
  const [year, month] = ym.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleString("en-US", { month: "long", year: "numeric" });
}

function PctChange({ pct, invertColor = false }: { pct: number | null; invertColor?: boolean }) {
  if (pct === null) return <span className="text-xs text-gray-300">—</span>;
  const up = pct > 0;
  const good = invertColor ? !up : up;
  const colorClass = pct === 0 ? "text-gray-400" : good ? "text-green-600" : "text-red-600";
  const sign = up ? "+" : "";
  return (
    <span className={`text-xs font-normal ${colorClass}`}>
      {sign}
      {pct.toFixed(1)}%
    </span>
  );
}

function monthParams(ym: string, extra?: Record<string, string>): string {
  const [year, month] = ym.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return new URLSearchParams({
    date_from: `${ym}-01`,
    date_to: `${ym}-${String(lastDay).padStart(2, "0")}`,
    ...extra,
  }).toString();
}

export default function MonthlyPage() {
  const [months, setMonths] = useState<string[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedMonth = searchParams.get("month");
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [loadingMonths, setLoadingMonths] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMonths()
      .then((data) => {
        setMonths(data.months);
        if (!searchParams.get("month") && data.months.length > 0) {
          setSearchParams({ month: data.months[0] }, { replace: true });
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingMonths(false));
  }, []);

  useEffect(() => {
    if (!selectedMonth) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingReport(true);
    setReport(null);
    getMonthlyReport(selectedMonth)
      .then((data) => setReport(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoadingReport(false));
  }, [selectedMonth]);

  useEffect(() => {
    if (!selectedMonth) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSummary(null);
    setSummaryLoading(true);
    getMonthlyReportSummary(selectedMonth)
      .then(setSummary)
      .catch(() => {})
      .finally(() => setSummaryLoading(false));
  }, [selectedMonth]);

  const handleRegenerate = useCallback(() => {
    if (!selectedMonth) return;
    setSummary(null);
    setSummaryLoading(true);
    getMonthlyReportSummary(selectedMonth, true)
      .then(setSummary)
      .catch(() => {})
      .finally(() => setSummaryLoading(false));
  }, [selectedMonth]);

  // Group months by year
  const byYear: Record<string, string[]> = {};
  for (const m of months) {
    const year = m.slice(0, 4);
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push(m);
  }
  const years = Object.keys(byYear).sort((a, b) => Number(b) - Number(a));

  return (
    <div className="flex h-full min-h-screen">
      {/* Month list */}
      <aside className="w-52 shrink-0 border-r border-gray-200 bg-white overflow-y-auto">
        <div className="px-4 py-5 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Monthly</h2>
        </div>
        {loadingMonths ? (
          <p className="px-4 py-4 text-sm text-gray-500">Loading…</p>
        ) : months.length === 0 ? (
          <p className="px-4 py-4 text-sm text-gray-500">No data yet.</p>
        ) : (
          <div className="px-2 py-3 space-y-4">
            {years.map((year) => (
              <div key={year}>
                <p className="px-2 mb-1 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  {year}
                </p>
                <ul className="space-y-0.5">
                  {byYear[year].map((ym) => {
                    const [, month] = ym.split("-");
                    const label = new Date(Number(year), Number(month) - 1, 1).toLocaleString(
                      "en-US",
                      { month: "long" }
                    );
                    const isSelected = ym === selectedMonth;
                    return (
                      <li key={ym}>
                        <button
                          onClick={() => setSearchParams({ month: ym })}
                          className={
                            "w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors " +
                            (isSelected
                              ? "bg-indigo-50 text-indigo-700 font-medium"
                              : "text-gray-700 hover:bg-gray-100")
                          }
                        >
                          {label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </aside>

      {/* Report panel */}
      <div className="flex-1 overflow-y-auto p-8">
        {error && (
          <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {!selectedMonth && !loadingMonths && (
          <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
            Select a month to view its report.
          </div>
        )}

        {loadingReport && <p className="text-sm text-gray-500">Loading…</p>}

        {report && (
          <div className="max-w-4xl space-y-8">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-bold text-gray-900">{formatMonth(report.month)}</h1>
              <HelpIcon section="monthly" />
            </div>
            <p className="text-sm text-gray-500 mb-6">
              A detailed breakdown of income and spending for the selected month.
            </p>

            {/* Summary cards */}
            <div>
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                  Summary
                </h2>
                <div className="flex items-baseline gap-3">
                  <span className="text-xs text-gray-400">
                    {report.summary.transaction_count} transactions
                  </span>
                  <Link
                    to={`/transactions?${monthParams(report.month)}`}
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    View all transactions →
                  </Link>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-4">
                <div className="rounded-lg border border-gray-200 bg-white p-4">
                  <p className="text-xs text-gray-500 mb-1">Income</p>
                  <p className="text-lg font-semibold text-green-700">
                    {formatCurrency(report.summary.income)}
                  </p>
                  <PctChange pct={report.summary.income_pct_change} />
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-4">
                  <p className="text-xs text-gray-500 mb-1">Expenses</p>
                  <p className="text-lg font-semibold text-red-600">
                    {formatCurrency(report.summary.expenses)}
                  </p>
                  <PctChange pct={report.summary.expenses_pct_change} invertColor />
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-4">
                  <p className="text-xs text-gray-500 mb-1">Net</p>
                  <p className={`text-lg font-semibold ${amountColor(report.summary.net)}`}>
                    {formatCurrency(report.summary.net)}
                  </p>
                  <PctChange pct={report.summary.net_pct_change} />
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-4">
                  <p className="text-xs text-gray-500 mb-1">Savings Rate</p>
                  <p className="text-lg font-semibold text-blue-700">
                    {report.summary.savings_rate !== null
                      ? `${report.summary.savings_rate.toFixed(1)}%`
                      : "—"}
                  </p>
                </div>
              </div>
            </div>

            {/* AI Summary */}
            {(summaryLoading || summary) && (
              <AiSummaryCard
                summary={summary}
                loading={summaryLoading}
                onRegenerate={handleRegenerate}
              />
            )}

            {/* Spending chart */}
            {report.category_breakdown.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                  Spending by Category
                </h2>
                <SpendingChart breakdown={report.category_breakdown} />
              </div>
            )}

            {/* Category breakdown */}
            <div>
              {report.category_breakdown.length === 0 ? (
                <p className="text-sm text-gray-500">No categorized spending this month.</p>
              ) : (
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      {report.category_breakdown.map((cat) => (
                        <>
                          <tr
                            key={cat.category}
                            className="bg-gray-100 border-t border-gray-200 first:border-t-0"
                          >
                            <td className="px-4 py-2 font-semibold text-gray-800">
                              <Link
                                to={`/transactions?${monthParams(report.month, { category: cat.category })}`}
                                className="hover:text-indigo-600 hover:underline"
                              >
                                {cat.category}
                              </Link>
                            </td>
                            <td className="px-4 py-2 font-semibold text-red-600 whitespace-nowrap">
                              <div className="flex items-center justify-end">
                                <span>{formatCurrency(cat.total)}</span>
                                <div className="w-16 text-right shrink-0">
                                  <PctChange pct={cat.pct_change} invertColor />
                                </div>
                              </div>
                            </td>
                          </tr>
                          {cat.subcategories.map((sub) => (
                            <tr
                              key={`${cat.category}-${sub.subcategory}`}
                              className="bg-white border-t border-gray-100"
                            >
                              <td className="pl-8 pr-4 py-1.5 text-gray-600">
                                <Link
                                  to={`/transactions?${monthParams(report.month, { category: cat.category, subcategory: sub.subcategory })}`}
                                  className="hover:text-indigo-600 hover:underline"
                                >
                                  {sub.subcategory}
                                </Link>
                              </td>
                              <td className="px-4 py-1.5 text-red-500 whitespace-nowrap">
                                <div className="flex items-center justify-end">
                                  <span>{formatCurrency(sub.total)}</span>
                                  <div className="w-16 text-right shrink-0">
                                    <PctChange pct={sub.pct_change} invertColor />
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
