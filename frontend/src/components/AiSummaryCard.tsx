import ReactMarkdown, { type Components } from "react-markdown";
import type { ReportSummary } from "../types";

interface AiSummaryCardProps {
  summary: ReportSummary | null;
  loading: boolean;
  onRegenerate: () => void;
  className?: string;
}

const mdComponents: Components = {
  p: ({ children }) => <span>{children}</span>,
  strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
};

export default function AiSummaryCard({
  summary,
  loading,
  onRegenerate,
  className,
}: AiSummaryCardProps) {
  return (
    <div
      className={`rounded-lg border border-indigo-100 bg-indigo-50 p-5 space-y-4 ${className ?? ""}`}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-indigo-700 uppercase tracking-wide">
          AI Summary
        </h2>
        <button
          onClick={onRegenerate}
          disabled={loading}
          className="text-xs text-indigo-500 hover:text-indigo-700 disabled:opacity-40 flex items-center gap-1"
          title="Regenerate summary"
        >
          {loading ? (
            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
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
          ) : (
            <span>↻</span>
          )}
          Regenerate
        </button>
      </div>
      {loading && !summary ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-3 bg-indigo-200 rounded w-3/4" />
          <div className="h-3 bg-indigo-200 rounded w-full" />
          <div className="h-3 bg-indigo-200 rounded w-5/6" />
        </div>
      ) : summary ? (
        <>
          <p className="text-sm text-gray-700">
            <ReactMarkdown components={mdComponents}>{summary.narrative}</ReactMarkdown>
          </p>
          <div>
            <p className="text-xs font-semibold text-gray-600 uppercase mb-1">Key Insights</p>
            <ul className="space-y-1">
              {summary.insights.map((insight, i) => (
                <li key={i} className="text-sm text-gray-700 flex gap-2">
                  <span className="text-indigo-400 mt-0.5">•</span>
                  <ReactMarkdown components={mdComponents}>{insight}</ReactMarkdown>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-600 uppercase mb-1">Recommendations</p>
            <ul className="space-y-1">
              {summary.recommendations.map((rec, i) => (
                <li key={i} className="text-sm text-gray-700 flex gap-2">
                  <span className="text-indigo-400 mt-0.5">→</span>
                  <ReactMarkdown components={mdComponents}>{rec}</ReactMarkdown>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
