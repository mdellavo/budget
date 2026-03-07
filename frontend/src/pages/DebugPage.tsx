import { useEffect, useState } from "react";
import { getEnrichmentDebug } from "../api/client";
import type { BatchItem, EnrichmentDebugResponse, ImportBatchSummary } from "../types";

const INPUT_COST_PER_MTOK = 3.0; // $3 per million input tokens (claude-sonnet-4-6)
const OUTPUT_COST_PER_MTOK = 15.0; // $15 per million output tokens (claude-sonnet-4-6)

function calcCost(inputTok: number, outputTok: number): number {
  return (
    (inputTok / 1_000_000) * INPUT_COST_PER_MTOK + (outputTok / 1_000_000) * OUTPUT_COST_PER_MTOK
  );
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

function formatNum(n: number): string {
  return n.toLocaleString();
}

function duration(b: BatchItem): string {
  if (!b.completed_at) return "—";
  const ms = new Date(b.completed_at).getTime() - new Date(b.started_at).getTime();
  return `${(ms / 1000).toFixed(1)}s`;
}

function BatchSubTable({ batches }: { batches: BatchItem[] }) {
  if (batches.length === 0)
    return <p className="text-gray-400 text-sm px-4 py-2">No batch records.</p>;
  return (
    <table className="w-full text-sm border-t border-gray-100">
      <thead>
        <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
          <th className="px-4 py-2 text-left">Batch #</th>
          <th className="px-4 py-2 text-right">Rows</th>
          <th className="px-4 py-2 text-right">Input tokens</th>
          <th className="px-4 py-2 text-right">Output tokens</th>
          <th className="px-4 py-2 text-right">Cost</th>
          <th className="px-4 py-2 text-center">Status</th>
          <th className="px-4 py-2 text-right">Duration</th>
        </tr>
      </thead>
      <tbody>
        {batches.map((b) => (
          <tr key={b.id} className="border-t border-gray-100">
            <td className="px-4 py-2 text-gray-600">{b.batch_num + 1}</td>
            <td className="px-4 py-2 text-right text-gray-600">{b.row_count}</td>
            <td className="px-4 py-2 text-right text-gray-600">{formatNum(b.input_tokens)}</td>
            <td className="px-4 py-2 text-right text-gray-600">{formatNum(b.output_tokens)}</td>
            <td className="px-4 py-2 text-right text-gray-600">
              {formatCost(calcCost(b.input_tokens, b.output_tokens))}
            </td>
            <td className="px-4 py-2 text-center">
              <span
                className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                  b.status === "success" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                }`}
              >
                {b.status}
              </span>
            </td>
            <td className="px-4 py-2 text-right text-gray-600">{duration(b)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ImportRow({ imp }: { imp: ImportBatchSummary }) {
  const [expanded, setExpanded] = useState(false);
  const cost = calcCost(imp.total_input_tokens, imp.total_output_tokens);

  return (
    <>
      <tr
        className="border-t border-gray-200 hover:bg-gray-50 cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        <td className="px-4 py-3 font-medium text-gray-800 max-w-xs truncate" title={imp.filename}>
          <span className="mr-2 text-gray-400">{expanded ? "▾" : "▸"}</span>
          {imp.filename}
        </td>
        <td className="px-4 py-3 text-gray-600 text-sm">
          {new Date(imp.imported_at).toLocaleDateString()}
        </td>
        <td className="px-4 py-3 text-center">
          <span
            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
              imp.status === "complete"
                ? "bg-green-100 text-green-700"
                : imp.status === "aborted"
                  ? "bg-red-100 text-red-700"
                  : "bg-yellow-100 text-yellow-700"
            }`}
          >
            {imp.status}
          </span>
        </td>
        <td className="px-4 py-3 text-right text-gray-600">{imp.batch_count}</td>
        <td className="px-4 py-3 text-right text-gray-600">{formatNum(imp.total_input_tokens)}</td>
        <td className="px-4 py-3 text-right text-gray-600">{formatNum(imp.total_output_tokens)}</td>
        <td className="px-4 py-3 text-right font-medium text-gray-800">{formatCost(cost)}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className="bg-gray-50 border-b border-gray-200">
            <BatchSubTable batches={imp.batches} />
          </td>
        </tr>
      )}
    </>
  );
}

export default function DebugPage() {
  const [data, setData] = useState<EnrichmentDebugResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getEnrichmentDebug()
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const totalCost = data ? calcCost(data.total_input_tokens, data.total_output_tokens) : 0;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Enrichment Debug</h1>

      {loading && <p className="text-gray-500">Loading…</p>}
      {error && <p className="text-red-600">{error}</p>}

      {data && (
        <>
          {/* Summary card */}
          <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                Total input tokens
              </div>
              <div className="text-xl font-semibold text-gray-800">
                {formatNum(data.total_input_tokens)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                Total output tokens
              </div>
              <div className="text-xl font-semibold text-gray-800">
                {formatNum(data.total_output_tokens)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total tokens</div>
              <div className="text-xl font-semibold text-gray-800">
                {formatNum(data.total_input_tokens + data.total_output_tokens)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                Estimated cost
              </div>
              <div className="text-xl font-semibold text-indigo-600">{formatCost(totalCost)}</div>
            </div>
            <div className="col-span-2 sm:col-span-4 text-xs text-gray-400">
              Pricing: claude-sonnet-4-6 — $3.00/MTok input, $15.00/MTok output. Cache tokens not
              broken out separately.
            </div>
          </div>

          {data.imports.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
              No enrichment batches recorded yet. Import a CSV to see data here.
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <th className="px-4 py-3 text-left">File</th>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Batches</th>
                    <th className="px-4 py-3 text-right">Input tokens</th>
                    <th className="px-4 py-3 text-right">Output tokens</th>
                    <th className="px-4 py-3 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {data.imports.map((imp) => (
                    <ImportRow key={imp.id} imp={imp} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
