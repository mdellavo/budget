import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getRecurring } from "../api/client";
import type { RecurringItem } from "../types";

const TODAY = new Date().toISOString().slice(0, 10);

function formatCurrency(amount: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(parseFloat(amount));
}

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString();
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function RecurringPage() {
  const [items, setItems] = useState<RecurringItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getRecurring()
      .then((data) => setItems(data.items))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Recurring Charges</h1>

      {loading && <div className="text-gray-500">Loading…</div>}

      {error && (
        <div className="text-red-600 bg-red-50 border border-red-200 rounded p-4">{error}</div>
      )}

      {items && items.length === 0 && (
        <div className="text-gray-500">No recurring charges detected.</div>
      )}

      {items && items.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {["Merchant", "Category", "Typical Amount", "Frequency", "/month", "Occurrences", "Last Charge", "Est. Next"].map((col) => (
                  <th
                    key={col}
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item, i) => {
                const isOverdue = item.next_estimated < TODAY;
                return (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <Link
                        to={`/transactions?merchant=${encodeURIComponent(item.merchant)}`}
                        className="text-indigo-600 hover:underline"
                      >
                        {item.merchant}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{item.category ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-900">{formatCurrency(item.amount)}</td>
                    <td className="px-4 py-3 text-gray-600">{capitalize(item.frequency)}</td>
                    <td className="px-4 py-3 text-gray-900">{formatCurrency(item.monthly_cost)}</td>
                    <td className="px-4 py-3 text-gray-600">{item.occurrences}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(item.last_charge)}</td>
                    <td className={`px-4 py-3 ${isOverdue ? "text-red-600 font-bold" : "text-gray-600"}`}>
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
