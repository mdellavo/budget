import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AiSummaryCard from "../components/AiSummaryCard";
import SpendingChart from "../components/SpendingChart";
import { listYears, getYearlyReport, getYearlyReportSummary } from "../api/client";
import { formatCurrency, amountColor } from "../lib/format";
import type { YearlyReport, ReportSummary } from "../types";

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

function yearParams(year: string, extra?: Record<string, string>): string {
  return new URLSearchParams({
    date_from: `${year}-01-01`,
    date_to: `${year}-12-31`,
    ...extra,
  }).toString();
}

export default function YearlyPage() {
  const [years, setYears] = useState<string[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedYear = searchParams.get("year");
  const [report, setReport] = useState<YearlyReport | null>(null);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [loadingYears, setLoadingYears] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listYears()
      .then((data) => {
        setYears(data.years);
        if (!searchParams.get("year") && data.years.length > 0) {
          setSearchParams({ year: data.years[0] }, { replace: true });
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingYears(false));
  }, []);

  useEffect(() => {
    if (!selectedYear) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingReport(true);
    setReport(null);
    getYearlyReport(selectedYear)
      .then((data) => setReport(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoadingReport(false));
  }, [selectedYear]);

  useEffect(() => {
    if (!selectedYear) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSummary(null);
    setSummaryLoading(true);
    getYearlyReportSummary(selectedYear)
      .then(setSummary)
      .catch(() => {})
      .finally(() => setSummaryLoading(false));
  }, [selectedYear]);

  const handleRegenerate = useCallback(() => {
    if (!selectedYear) return;
    setSummary(null);
    setSummaryLoading(true);
    getYearlyReportSummary(selectedYear, true)
      .then(setSummary)
      .catch(() => {})
      .finally(() => setSummaryLoading(false));
  }, [selectedYear]);

  return (
    <div className="flex h-full min-h-screen">
      {/* Year list */}
      <aside className="w-40 shrink-0 border-r border-gray-200 bg-white overflow-y-auto">
        <div className="px-4 py-5 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Yearly</h2>
        </div>
        {loadingYears ? (
          <p className="px-4 py-4 text-sm text-gray-500">Loading…</p>
        ) : years.length === 0 ? (
          <p className="px-4 py-4 text-sm text-gray-500">No data yet.</p>
        ) : (
          <ul className="px-2 py-3 space-y-0.5">
            {years.map((year) => {
              const isSelected = year === selectedYear;
              return (
                <li key={year}>
                  <button
                    onClick={() => setSearchParams({ year })}
                    className={
                      "w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors " +
                      (isSelected
                        ? "bg-indigo-50 text-indigo-700 font-medium"
                        : "text-gray-700 hover:bg-gray-100")
                    }
                  >
                    {year}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {/* Report panel */}
      <div className="flex-1 overflow-y-auto p-8">
        {error && (
          <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {!selectedYear && !loadingYears && (
          <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
            Select a year to view its report.
          </div>
        )}

        {loadingReport && <p className="text-sm text-gray-500">Loading…</p>}

        {report && (
          <div className="max-w-4xl space-y-8">
            <div className="mb-1">
              <h1 className="text-2xl font-bold text-gray-900">{report.year}</h1>
              <p className="text-sm text-gray-500 mt-1">Annual report</p>
            </div>

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
                    to={`/transactions?${yearParams(report.year)}`}
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
                <p className="text-sm text-gray-500">No categorized spending this year.</p>
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
                                to={`/transactions?${yearParams(report.year, { category: cat.category })}`}
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
                                  to={`/transactions?${yearParams(report.year, { category: cat.category, subcategory: sub.subcategory })}`}
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
