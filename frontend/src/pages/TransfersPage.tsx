import { useState, useEffect, useCallback } from "react";
import { listTransactions, updateTransaction, rematchTransfers } from "../api/client";
import HelpIcon from "../components/HelpIcon";
import type { TransactionItem } from "../types";

function formatAmount(amount: string): { text: string; positive: boolean } {
  const n = parseFloat(amount);
  return {
    text: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
      Math.abs(n)
    ),
    positive: n >= 0,
  };
}

interface MatchedPairProps {
  debit: TransactionItem;
  credit: TransactionItem;
  onUnlink: (txId: number, linkedId: number) => void;
  unlinking: Set<number>;
}

function MatchedPair({ debit, credit, onUnlink, unlinking }: MatchedPairProps) {
  const d = formatAmount(debit.amount);
  const c = formatAmount(credit.amount);
  const isWorking = unlinking.has(debit.id) || unlinking.has(credit.id);

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="divide-y divide-gray-100">
        {[
          { tx: debit, fmt: d },
          { tx: credit, fmt: c },
        ].map(({ tx, fmt }) => (
          <div key={tx.id} className="px-4 py-3 flex items-center gap-3">
            <span className="text-base text-gray-400 shrink-0">↔</span>
            <div className="w-24 shrink-0 text-sm text-gray-500">{tx.date}</div>
            <div className="w-36 shrink-0 text-sm text-gray-700 truncate">{tx.account}</div>
            <div className="flex-1 min-w-0 text-sm text-gray-900 truncate">{tx.description}</div>
            <span
              className={`shrink-0 font-mono text-sm font-semibold ${fmt.positive ? "text-green-600" : "text-red-600"}`}
            >
              {fmt.positive ? "+" : "−"}
              {fmt.text}
            </span>
          </div>
        ))}
      </div>
      <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex justify-end">
        <button
          type="button"
          onClick={() => onUnlink(debit.id, credit.id)}
          disabled={isWorking}
          className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
        >
          {isWorking ? "Unlinking…" : "Unlink"}
        </button>
      </div>
    </div>
  );
}

interface UnmatchedRowProps {
  tx: TransactionItem;
}

function UnmatchedRow({ tx }: UnmatchedRowProps) {
  const { text, positive } = formatAmount(tx.amount);
  return (
    <div className="bg-white rounded-lg border border-amber-200 shadow-sm px-4 py-3 flex items-center gap-3">
      <span className="text-amber-500 text-base shrink-0" title="Unmatched transfer">
        ⚠
      </span>
      <div className="w-24 shrink-0 text-sm text-gray-500">{tx.date}</div>
      <div className="w-36 shrink-0 text-sm text-gray-700 truncate">{tx.account}</div>
      <div className="flex-1 min-w-0 text-sm text-gray-900 truncate">{tx.description}</div>
      <span
        className={`shrink-0 font-mono text-sm font-semibold ${positive ? "text-green-600" : "text-red-600"}`}
      >
        {positive ? "+" : "−"}
        {text}
      </span>
    </div>
  );
}

export default function TransfersPage() {
  const [transfers, setTransfers] = useState<TransactionItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState<Set<number>>(new Set());
  const [rematching, setRematching] = useState(false);
  const [rematchMsg, setRematchMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch all transfer-channel transactions (no limit — iterate pages)
      const all: TransactionItem[] = [];
      let after: number | undefined;
      for (;;) {
        const res = await listTransactions({
          payment_channel: "transfer",
          limit: 200,
          sort_by: "date",
          sort_dir: "desc",
          after,
        });
        all.push(...res.items);
        if (!res.has_more || res.next_cursor == null) break;
        after = res.next_cursor;
      }
      setTransfers(all);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUnlink(txId: number, linkedId: number) {
    setUnlinking((prev) => new Set([...prev, txId, linkedId]));
    try {
      const tx = transfers?.find((t) => t.id === txId);
      if (!tx) return;
      await updateTransaction(txId, {
        description: tx.description,
        merchant_name: tx.merchant ?? null,
        category: tx.category ?? null,
        subcategory: tx.subcategory ?? null,
        notes: tx.notes ?? null,
        tags: tx.tags ?? [],
        clear_linked_transaction: true,
      });
      // Refresh data to reflect cleared links on both sides
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to unlink");
    } finally {
      setUnlinking((prev) => {
        const next = new Set(prev);
        next.delete(txId);
        next.delete(linkedId);
        return next;
      });
    }
  }

  async function handleRematch() {
    setRematching(true);
    setRematchMsg(null);
    try {
      const res = await rematchTransfers();
      setRematchMsg(
        res.pairs_linked === 0
          ? "No new pairs found."
          : `Linked ${res.pairs_linked} new pair${res.pairs_linked === 1 ? "" : "s"}.`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Re-match failed");
    } finally {
      setRematching(false);
    }
  }

  // Build matched pairs and unmatched lists
  const matched: Array<{ debit: TransactionItem; credit: TransactionItem }> = [];
  const unmatched: TransactionItem[] = [];
  const seen = new Set<number>();

  if (transfers) {
    const byId = new Map(transfers.map((t) => [t.id, t]));
    for (const tx of transfers) {
      if (seen.has(tx.id)) continue;
      if (tx.linked_transaction_id != null) {
        const other = byId.get(tx.linked_transaction_id);
        if (other && !seen.has(other.id)) {
          const debit = parseFloat(tx.amount) < 0 ? tx : other;
          const credit = parseFloat(tx.amount) >= 0 ? tx : other;
          matched.push({ debit, credit });
          seen.add(tx.id);
          seen.add(other.id);
        } else if (!other) {
          // Linked to a tx not in the transfer set — show as unmatched
          unmatched.push(tx);
          seen.add(tx.id);
        }
      } else {
        unmatched.push(tx);
        seen.add(tx.id);
      }
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">Transfers</h1>
            <HelpIcon section="transfers" />
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Transfer transactions grouped by matched pairs. Unmatched transfers may indicate a
            missing leg or miscategorisation.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {rematchMsg && <span className="text-sm text-gray-500">{rematchMsg}</span>}
          <button
            type="button"
            onClick={handleRematch}
            disabled={rematching}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            {rematching ? "Re-matching…" : "Re-match"}
          </button>
        </div>
      </div>

      {loading && <div className="text-sm text-gray-500">Loading…</div>}

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
          {error}
        </div>
      )}

      {!loading && !error && transfers !== null && (
        <>
          {/* Matched Pairs */}
          <section className="mb-8">
            <h2 className="text-base font-semibold text-gray-700 mb-3">
              Matched Pairs
              <span className="ml-2 text-sm font-normal text-gray-400">({matched.length})</span>
            </h2>
            {matched.length === 0 ? (
              <div className="text-sm text-gray-400 py-4">No matched pairs.</div>
            ) : (
              <div className="space-y-3">
                {matched.map(({ debit, credit }) => (
                  <MatchedPair
                    key={`${debit.id}-${credit.id}`}
                    debit={debit}
                    credit={credit}
                    onUnlink={handleUnlink}
                    unlinking={unlinking}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Unmatched Transfers */}
          <section>
            <h2 className="text-base font-semibold text-gray-700 mb-3">
              Unmatched Transfers
              <span className="ml-2 text-sm font-normal text-gray-400">({unmatched.length})</span>
            </h2>
            {unmatched.length === 0 ? (
              <div className="text-sm text-gray-400 py-4">All transfers are matched.</div>
            ) : (
              <div className="space-y-2">
                {unmatched.map((tx) => (
                  <UnmatchedRow key={tx.id} tx={tx} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
