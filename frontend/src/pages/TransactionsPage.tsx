import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  listTransactions,
  listMerchants,
  listCategories,
  listCardHolders,
  parseQuery,
  updateTransaction,
  reEnrichTransactions,
} from "../api/client";
import type { TransactionFilters, TransactionUpdateBody } from "../api/client";
import type { CardHolderItem, CategoryItem, TransactionItem } from "../types";
import ComboBox from "../components/ComboBox";

type SortKey = "date" | "amount" | "description" | "merchant" | "category" | "account";

const COLUMNS: { label: string; key: SortKey; rightAlign?: boolean }[] = [
  { label: "Date", key: "date" },
  { label: "Description", key: "description" },
  { label: "Merchant", key: "merchant" },
  { label: "Category / Subcategory", key: "category" },
  { label: "Amount", key: "amount", rightAlign: true },
  { label: "Account", key: "account" },
];

function formatAmount(amount: string): { text: string; positive: boolean } {
  const n = parseFloat(amount);
  return {
    text: new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(n),
    positive: n >= 0,
  };
}

const EMPTY_FILTERS = {
  date_from: "",
  date_to: "",
  merchant: "",
  description: "",
  amount_min: "",
  amount_max: "",
  category: "",
  subcategory: "",
  account: "",
  import_id: "",
  is_recurring: "",
  uncategorized: "",
  cardholder: "",
};

type FormFilters = typeof EMPTY_FILTERS;

function filtersFromParams(p: URLSearchParams): FormFilters {
  return {
    date_from: p.get("date_from") ?? "",
    date_to: p.get("date_to") ?? "",
    merchant: p.get("merchant") ?? "",
    description: p.get("description") ?? "",
    amount_min: p.get("amount_min") ?? "",
    amount_max: p.get("amount_max") ?? "",
    category: p.get("category") ?? "",
    subcategory: p.get("subcategory") ?? "",
    account: p.get("account") ?? "",
    import_id: p.get("import_id") ?? "",
    is_recurring: p.get("is_recurring") ?? "",
    uncategorized: p.get("uncategorized") ?? "",
    cardholder: p.get("cardholder") ?? "",
  };
}

function buildParams(f: FormFilters, sb: SortKey, sd: "asc" | "desc"): URLSearchParams {
  const p = new URLSearchParams();
  if (f.date_from) p.set("date_from", f.date_from);
  if (f.date_to) p.set("date_to", f.date_to);
  if (f.merchant) p.set("merchant", f.merchant);
  if (f.description) p.set("description", f.description);
  if (f.amount_min) p.set("amount_min", f.amount_min);
  if (f.amount_max) p.set("amount_max", f.amount_max);
  if (f.category) p.set("category", f.category);
  if (f.subcategory) p.set("subcategory", f.subcategory);
  if (f.account) p.set("account", f.account);
  if (f.import_id) p.set("import_id", f.import_id);
  if (f.is_recurring) p.set("is_recurring", f.is_recurring);
  if (f.uncategorized) p.set("uncategorized", f.uncategorized);
  if (f.cardholder) p.set("cardholder", f.cardholder);
  if (sb !== "date") p.set("sort_by", sb);
  if (sd !== "desc") p.set("sort_dir", sd);
  return p;
}

function toApiFilters(f: FormFilters): TransactionFilters {
  const out: TransactionFilters = {};
  if (f.date_from) out.date_from = f.date_from;
  if (f.date_to) out.date_to = f.date_to;
  if (f.merchant) out.merchant = f.merchant;
  if (f.description) out.description = f.description;
  if (f.amount_min) out.amount_min = f.amount_min;
  if (f.amount_max) out.amount_max = f.amount_max;
  if (f.category) out.category = f.category;
  if (f.subcategory) out.subcategory = f.subcategory;
  if (f.account) out.account = f.account;
  if (f.import_id) out.import_id = parseInt(f.import_id, 10);
  if (f.is_recurring === "true") out.is_recurring = true;
  else if (f.is_recurring === "false") out.is_recurring = false;
  if (f.uncategorized === "true") out.uncategorized = true;
  if (f.cardholder) out.cardholder = f.cardholder;
  return out;
}

// ---------------------------------------------------------------------------
// EditTransactionModal
// ---------------------------------------------------------------------------

interface EditTransactionModalProps {
  tx: TransactionItem;
  onClose: () => void;
  onSaved: (updated: TransactionItem) => void;
}

function EditTransactionModal({ tx, onClose, onSaved }: EditTransactionModalProps) {
  const [form, setForm] = useState({
    description: tx.description,
    merchant: tx.merchant ?? "",
    category: tx.category ?? "",
    subcategory: tx.subcategory ?? "",
    notes: tx.notes ?? "",
    card_number: tx.card_number ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [reEnriching, setReEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [merchantSuggestions, setMerchantSuggestions] = useState<string[]>([]);
  const [allCategoryRows, setAllCategoryRows] = useState<CategoryItem[]>([]);

  // Load all category rows on mount
  useEffect(() => {
    listCategories()
      .then((res) => setAllCategoryRows(res.items))
      .catch(() => {});
  }, []);

  // Debounced merchant suggestions
  const merchantDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (merchantDebounce.current) clearTimeout(merchantDebounce.current);
    const query = form.merchant.trim();
    if (!query) {
      setMerchantSuggestions([]);
      return;
    }
    merchantDebounce.current = setTimeout(async () => {
      try {
        const res = await listMerchants({ name: query, limit: 20 });
        setMerchantSuggestions(res.items.map((m) => m.name));
      } catch {
        setMerchantSuggestions([]);
      }
    }, 300);
    return () => {
      if (merchantDebounce.current) clearTimeout(merchantDebounce.current);
    };
  }, [form.merchant]);

  // Category suggestions (client-side)
  const categoryQuery = form.category.toLowerCase();
  const categorySuggestions = Array.from(
    new Set(
      allCategoryRows.map((r) => r.category).filter((c) => c.toLowerCase().includes(categoryQuery))
    )
  );

  // Subcategory suggestions (client-side, filtered by selected category)
  const subcategoryQuery = form.subcategory.toLowerCase();
  const subcategorySuggestions = Array.from(
    new Set(
      allCategoryRows
        .filter((r) => !form.category || r.category === form.category)
        .map((r) => r.subcategory)
        .filter((s) => s.toLowerCase().includes(subcategoryQuery))
    )
  );

  function setField(key: keyof typeof form, value: string) {
    if (key === "category") {
      setForm((prev) => ({ ...prev, category: value, subcategory: "" }));
    } else {
      setForm((prev) => ({ ...prev, [key]: value }));
    }
  }

  async function handleReEnrich() {
    setReEnriching(true);
    setError(null);
    try {
      const res = await reEnrichTransactions([tx.id]);
      if (res.items[0]) {
        const updated = res.items[0];
        setForm({
          description: updated.description,
          merchant: updated.merchant ?? "",
          category: updated.category ?? "",
          subcategory: updated.subcategory ?? "",
          notes: updated.notes ?? "",
          card_number: updated.card_number ?? "",
        });
        onSaved(updated);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Re-enrich failed");
    } finally {
      setReEnriching(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const body: TransactionUpdateBody = {
        description: form.description,
        merchant_name: form.merchant.trim() || null,
        category: form.category.trim() || null,
        subcategory: form.subcategory.trim() || null,
        notes: form.notes.trim() || null,
        card_number: form.card_number.trim() || null,
      };
      const updated = await updateTransaction(tx.id, body);
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const inputClass =
    "w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500";

  const { text: amountText } = formatAmount(tx.amount);

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-lg w-full"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Edit Transaction</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
            aria-label="Close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Meta info */}
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 text-sm text-gray-600 space-y-0.5">
          <div className="flex gap-4">
            <span>
              <span className="font-medium">Date:</span> {tx.date}
            </span>
            <span>
              <span className="font-medium">Amount:</span> {amountText}
            </span>
          </div>
          <div>
            <span className="font-medium">Account:</span> {tx.account}
          </div>
        </div>

        {/* Form */}
        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-[120px_1fr] items-center gap-x-3 gap-y-3">
            <div className="flex justify-between items-center">
              <label className="text-sm text-gray-700 font-medium">Description</label>
              {tx.raw_description && (
                <button
                  type="button"
                  onClick={handleReEnrich}
                  disabled={reEnriching || saving}
                  className="text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-50 flex items-center gap-1"
                >
                  {reEnriching ? "Re-enriching…" : "Re-enrich"}
                </button>
              )}
            </div>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
              className={inputClass}
            />

            <label className="text-sm text-gray-700 font-medium text-right">Merchant</label>
            <ComboBox
              value={form.merchant}
              onChange={(v) => setField("merchant", v)}
              suggestions={merchantSuggestions}
              placeholder="e.g. Starbucks"
              className={inputClass}
            />

            <label className="text-sm text-gray-700 font-medium text-right">Category</label>
            <ComboBox
              value={form.category}
              onChange={(v) => setField("category", v)}
              suggestions={categorySuggestions}
              placeholder="e.g. Food"
              className={inputClass}
            />

            <label className="text-sm text-gray-700 font-medium text-right">Subcategory</label>
            <ComboBox
              value={form.subcategory}
              onChange={(v) => setField("subcategory", v)}
              suggestions={subcategorySuggestions}
              placeholder="e.g. Groceries"
              className={inputClass}
            />

            <label className="text-sm text-gray-700 font-medium text-right">Notes</label>
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setField("notes", e.target.value)}
              placeholder="Optional notes"
              className={inputClass}
            />

            <label className="text-sm text-gray-700 font-medium text-right">Card number</label>
            <input
              type="text"
              value={form.card_number}
              onChange={(e) => setField("card_number", e.target.value)}
              placeholder="e.g. 1234"
              className={inputClass + " font-mono"}
            />
          </div>

          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !form.description.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TransactionDetailModal
// ---------------------------------------------------------------------------

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex py-2.5 border-b border-gray-100 last:border-0">
      <dt className="w-32 shrink-0 text-sm font-medium text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900 min-w-0 break-words">{children}</dd>
    </div>
  );
}

interface TransactionDetailModalProps {
  tx: TransactionItem;
  onClose: () => void;
  onEdit: (tx: TransactionItem) => void;
}

function TransactionDetailModal({ tx, onClose, onEdit }: TransactionDetailModalProps) {
  const { text: amountText, positive } = formatAmount(tx.amount);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-md w-full"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Transaction Details</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
            aria-label="Close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Fields */}
        <dl className="px-5 py-1">
          <Row label="Date">{tx.date}</Row>
          <Row label="Description">{tx.description}</Row>
          {tx.raw_description && tx.raw_description !== tx.description && (
            <Row label="Raw description">
              <span className="font-mono text-xs text-gray-500">{tx.raw_description}</span>
            </Row>
          )}
          <Row label="Amount">
            <span
              className={`font-mono font-medium ${positive ? "text-green-600" : "text-red-600"}`}
            >
              {amountText}
            </span>
          </Row>
          <Row label="Account">{tx.account}</Row>
          <Row label="Merchant">{tx.merchant ?? <span className="text-gray-400">—</span>}</Row>
          <Row label="Category">{tx.category ?? <span className="text-gray-400">—</span>}</Row>
          <Row label="Subcategory">
            {tx.subcategory ?? <span className="text-gray-400">—</span>}
          </Row>
          <Row label="Notes">{tx.notes ?? <span className="text-gray-400">—</span>}</Row>
          {(tx.cardholder_name || tx.card_number) && (
            <Row label="Card">
              {tx.card_number && <span className="font-mono">{tx.card_number}</span>}
              {tx.cardholder_name && (
                <span className="ml-2 text-gray-500">{tx.cardholder_name}</span>
              )}
            </Row>
          )}
          <Row label="Recurring">
            {tx.is_recurring ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-600">
                Yes
              </span>
            ) : (
              <span className="text-gray-400">No</span>
            )}
          </Row>
          <Row label="ID">
            <span className="font-mono text-gray-400 text-xs">{tx.id}</span>
          </Row>
        </dl>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => onEdit(tx)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            </svg>
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BulkEditBar
// ---------------------------------------------------------------------------

interface BulkEditBarProps {
  count: number;
  onApply: (updates: {
    merchant: string;
    category: string;
    subcategory: string;
    card_number: string;
  }) => void;
  onClear: () => void;
  saving: boolean;
  error: string | null;
  eligibleForReEnrich: number;
  onReEnrich: () => void;
  reEnriching: boolean;
  reEnrichError: string | null;
}

function BulkEditBar({
  count,
  onApply,
  onClear,
  saving,
  error,
  eligibleForReEnrich,
  onReEnrich,
  reEnriching,
  reEnrichError,
}: BulkEditBarProps) {
  const [form, setForm] = useState({
    merchant: "",
    category: "",
    subcategory: "",
    card_number: "",
  });
  const [merchantSuggestions, setMerchantSuggestions] = useState<string[]>([]);
  const [allCategoryRows, setAllCategoryRows] = useState<CategoryItem[]>([]);

  useEffect(() => {
    listCategories()
      .then((res) => setAllCategoryRows(res.items))
      .catch(() => {});
  }, []);

  const merchantDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (merchantDebounce.current) clearTimeout(merchantDebounce.current);
    const query = form.merchant.trim();
    if (!query) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMerchantSuggestions([]);
      return;
    }
    merchantDebounce.current = setTimeout(async () => {
      try {
        const res = await listMerchants({ name: query, limit: 20 });
        setMerchantSuggestions(res.items.map((m) => m.name));
      } catch {
        setMerchantSuggestions([]);
      }
    }, 300);
    return () => {
      if (merchantDebounce.current) clearTimeout(merchantDebounce.current);
    };
  }, [form.merchant]);

  const categoryQuery = form.category.toLowerCase();
  const categorySuggestions = Array.from(
    new Set(
      allCategoryRows.map((r) => r.category).filter((c) => c.toLowerCase().includes(categoryQuery))
    )
  );

  const subcategoryQuery = form.subcategory.toLowerCase();
  const subcategorySuggestions = Array.from(
    new Set(
      allCategoryRows
        .filter((r) => !form.category || r.category === form.category)
        .map((r) => r.subcategory)
        .filter((s) => s.toLowerCase().includes(subcategoryQuery))
    )
  );

  function setField(key: keyof typeof form, value: string) {
    if (key === "category") {
      setForm((prev) => ({ ...prev, category: value, subcategory: "" }));
    } else {
      setForm((prev) => ({ ...prev, [key]: value }));
    }
  }

  const allEmpty =
    !form.merchant.trim() &&
    !form.category.trim() &&
    !form.subcategory.trim() &&
    !form.card_number.trim();

  const inputClass =
    "border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500";

  return (
    <div className="sticky top-0 z-10 mb-3 bg-indigo-50 border border-indigo-200 rounded-md shadow-sm">
      {eligibleForReEnrich > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-indigo-200">
          <button
            type="button"
            onClick={onReEnrich}
            disabled={reEnriching || saving}
            className="text-sm text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
          >
            {reEnriching ? "Re-enriching…" : `Re-enrich (${eligibleForReEnrich} eligible)`}
          </button>
          {reEnrichError && <span className="text-sm text-red-600">{reEnrichError}</span>}
        </div>
      )}
      <div className="px-4 py-3 flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-indigo-700 shrink-0">{count} selected</span>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-500 font-medium">Merchant</label>
          <ComboBox
            value={form.merchant}
            onChange={(v) => setField("merchant", v)}
            suggestions={merchantSuggestions}
            placeholder="(no change)"
            className={inputClass}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-500 font-medium">Category</label>
          <ComboBox
            value={form.category}
            onChange={(v) => setField("category", v)}
            suggestions={categorySuggestions}
            placeholder="(no change)"
            className={inputClass}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-500 font-medium">Subcategory</label>
          <ComboBox
            value={form.subcategory}
            onChange={(v) => setField("subcategory", v)}
            suggestions={subcategorySuggestions}
            placeholder="(no change)"
            className={inputClass}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-500 font-medium">Card number</label>
          <input
            type="text"
            value={form.card_number}
            onChange={(e) => setForm((prev) => ({ ...prev, card_number: e.target.value }))}
            placeholder="(no change)"
            className={inputClass + " font-mono w-28"}
          />
        </div>
        <button
          type="button"
          onClick={() => onApply(form)}
          disabled={allEmpty || saving}
          className="px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded hover:bg-indigo-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {saving ? "Applying…" : "Apply"}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="text-gray-400 hover:text-gray-700 focus:outline-none text-lg leading-none"
          aria-label="Clear selection"
          title="Clear selection"
        >
          ✕
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TransactionsPage
// ---------------------------------------------------------------------------

export default function TransactionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const appliedFilters = filtersFromParams(searchParams);
  const sortBy = (searchParams.get("sort_by") ?? "date") as SortKey;
  const sortDir = (searchParams.get("sort_dir") ?? "desc") as "asc" | "desc";

  const [filters, setFilters] = useState<FormFilters>(() => filtersFromParams(searchParams));

  // Sync draft to URL whenever URL changes externally (back/forward)
  useEffect(() => {
    setFilters(filtersFromParams(searchParams));
  }, [searchParams]);

  const [nlQuery, setNlQuery] = useState("");
  const [nlLoading, setNlLoading] = useState(false);
  const [nlExplanation, setNlExplanation] = useState<string | null>(null);
  const [nlError, setNlError] = useState<string | null>(null);

  async function handleNlSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nlQuery.trim()) return;
    setNlLoading(true);
    setNlError(null);
    setNlExplanation(null);
    try {
      const { filters: parsed, explanation } = await parseQuery(nlQuery.trim());
      const merged: FormFilters = {
        ...EMPTY_FILTERS,
        date_from: parsed.date_from ?? "",
        date_to: parsed.date_to ?? "",
        merchant: parsed.merchant ?? "",
        description: parsed.description ?? "",
        amount_min: parsed.amount_min ?? "",
        amount_max: parsed.amount_max ?? "",
        category: parsed.category ?? "",
        subcategory: parsed.subcategory ?? "",
        account: parsed.account ?? "",
        is_recurring: parsed.is_recurring != null ? String(parsed.is_recurring) : "",
      };
      setFilters(merged);
      setNlExplanation(explanation);
      setSearchParams(buildParams(merged, sortBy, sortDir));
    } catch (e) {
      setNlError(e instanceof Error ? e.message : "Failed to parse query");
    } finally {
      setNlLoading(false);
    }
  }

  const [pages, setPages] = useState<TransactionItem[][]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingTx, setEditingTx] = useState<TransactionItem | null>(null);
  const [viewingTx, setViewingTx] = useState<TransactionItem | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkReEnriching, setBulkReEnriching] = useState(false);
  const [bulkReEnrichError, setBulkReEnrichError] = useState<string | null>(null);

  const [allCardholders, setAllCardholders] = useState<CardHolderItem[]>([]);
  const [cardholderSuggestions, setCardholderSuggestions] = useState<string[]>([]);

  const fetchFirstPage = useCallback(
    async (formFilters: FormFilters, sb: SortKey, sd: "asc" | "desc") => {
      setLoading(true);
      setError(null);
      setPages([]);
      setSelectedIds(new Set());
      setNextCursor(null);
      setHasMore(false);
      setTotalCount(null);
      try {
        const res = await listTransactions({
          ...toApiFilters(formFilters),
          sort_by: sb,
          sort_dir: sd,
        });
        setPages([res.items]);
        setNextCursor(res.next_cursor);
        setHasMore(res.has_more);
        setTotalCount(res.total_count);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load transactions");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchFirstPage(appliedFilters, sortBy, sortDir);
  }, [searchParams, fetchFirstPage]);

  useEffect(() => {
    listCardHolders({ limit: 100 })
      .then((res) => setAllCardholders(res.items))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const query = filters.cardholder.trim().toLowerCase();
    if (!query) {
      setCardholderSuggestions([]);
      return;
    }
    const seen = new Set<string>();
    const suggestions: string[] = [];
    for (const ch of allCardholders) {
      if (
        ch.card_number &&
        ch.card_number.toLowerCase().includes(query) &&
        !seen.has(ch.card_number)
      ) {
        suggestions.push(ch.card_number);
        seen.add(ch.card_number);
      }
      if (ch.name && ch.name.toLowerCase().includes(query) && !seen.has(ch.name)) {
        suggestions.push(ch.name);
        seen.add(ch.name);
      }
    }
    setCardholderSuggestions(suggestions.slice(0, 10));
  }, [filters.cardholder, allCardholders]);

  function handleSort(key: SortKey) {
    const newDir = key === sortBy ? (sortDir === "asc" ? "desc" : "asc") : "desc";
    setSearchParams(buildParams(appliedFilters, key, newDir), { replace: true });
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await listTransactions({
        ...toApiFilters(appliedFilters),
        after: nextCursor,
        sort_by: sortBy,
        sort_dir: sortDir,
      });
      setPages((prev) => [...prev, res.items]);
      setNextCursor(res.next_cursor);
      setHasMore(res.has_more);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }

  function handleApply(e: React.FormEvent) {
    e.preventDefault();
    setSearchParams(buildParams(filters, sortBy, sortDir));
  }

  function handleClear() {
    setFilters(EMPTY_FILTERS);
    setSearchParams(buildParams(EMPTY_FILTERS, "date", "desc"));
  }

  function setField(key: keyof FormFilters, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function handleSaved(updated: TransactionItem) {
    setPages((prev) =>
      prev.map((page) => page.map((row) => (row.id === updated.id ? updated : row)))
    );
    setEditingTx(null);
    setViewingTx(null);
  }

  async function handleBulkApply(updates: {
    merchant: string;
    category: string;
    subcategory: string;
    card_number: string;
  }) {
    setBulkSaving(true);
    setBulkError(null);
    const ids = [...selectedIds];
    let failed = 0;
    for (const id of ids) {
      const tx = allRows.find((r) => r.id === id)!;
      try {
        const updated = await updateTransaction(id, {
          description: tx.description,
          merchant_name: updates.merchant.trim() || tx.merchant || null,
          category: updates.category.trim() || tx.category || null,
          subcategory: updates.subcategory.trim() || tx.subcategory || null,
          notes: tx.notes,
          card_number: updates.card_number.trim() || tx.card_number || null,
        });
        setPages((prev) =>
          prev.map((page) => page.map((r) => (r.id === updated.id ? updated : r)))
        );
      } catch {
        failed++;
      }
    }
    setBulkSaving(false);
    if (failed === 0) {
      setSelectedIds(new Set());
    } else {
      setBulkError(`${failed} transaction(s) failed to update`);
    }
  }

  const allRows = pages.flat();

  const eligibleForReEnrich = [...selectedIds].filter(
    (id) => allRows.find((r) => r.id === id)?.raw_description
  ).length;

  async function handleBulkReEnrich() {
    setBulkReEnriching(true);
    setBulkReEnrichError(null);
    try {
      const res = await reEnrichTransactions([...selectedIds]);
      setPages((prev) =>
        prev.map((page) =>
          page.map((r) => {
            const updated = res.items.find((u) => u.id === r.id);
            return updated ?? r;
          })
        )
      );
      setSelectedIds(new Set());
    } catch (e) {
      setBulkReEnrichError(e instanceof Error ? e.message : "Re-enrich failed");
    } finally {
      setBulkReEnriching(false);
    }
  }

  const selectAllRef = useRef<HTMLInputElement>(null);
  const allSelected = allRows.length > 0 && allRows.every((r) => selectedIds.has(r.id));
  const someSelected = allRows.some((r) => selectedIds.has(r.id));
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [someSelected, allSelected]);

  return (
    <div className="p-8">
      {viewingTx && !editingTx && (
        <TransactionDetailModal
          tx={viewingTx}
          onClose={() => setViewingTx(null)}
          onEdit={(tx) => {
            setViewingTx(null);
            setEditingTx(tx);
          }}
        />
      )}
      {editingTx && (
        <EditTransactionModal
          tx={editingTx}
          onClose={() => setEditingTx(null)}
          onSaved={handleSaved}
        />
      )}

      <div className="flex items-baseline gap-3 mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Transactions</h1>
        {totalCount !== null && (
          <span className="text-sm text-gray-500">
            {totalCount.toLocaleString()} {totalCount === 1 ? "transaction" : "transactions"}
          </span>
        )}
      </div>

      {/* Natural language query bar */}
      <form onSubmit={handleNlSubmit} className="mb-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={nlQuery}
            onChange={(e) => setNlQuery(e.target.value)}
            placeholder='Ask in plain English, e.g. "restaurants last quarter" or "groceries from Chase"'
            className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          <button
            type="submit"
            disabled={nlLoading || !nlQuery.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {nlLoading ? (
              <>
                <svg
                  className="animate-spin h-4 w-4"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
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
                Asking…
              </>
            ) : (
              "Ask"
            )}
          </button>
        </div>
        {nlExplanation && (
          <div className="mt-2 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-3.5 w-3.5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
              {nlExplanation}
            </span>
            <button
              type="button"
              onClick={() => setNlExplanation(null)}
              className="text-gray-400 hover:text-gray-600 text-xs"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}
        {nlError && <p className="mt-2 text-xs text-red-600">{nlError}</p>}
      </form>

      {/* Filter bar */}
      <form
        onSubmit={handleApply}
        className="mb-6 bg-white border border-gray-200 rounded-md shadow-sm p-4 space-y-3"
      >
        <div className="flex gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Date from</label>
            <input
              type="date"
              value={filters.date_from}
              onChange={(e) => setField("date_from", e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Date to</label>
            <input
              type="date"
              value={filters.date_to}
              onChange={(e) => setField("date_to", e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Merchant</label>
            <input
              type="text"
              value={filters.merchant}
              onChange={(e) => setField("merchant", e.target.value)}
              placeholder="e.g. Starbucks"
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Description</label>
            <input
              type="text"
              value={filters.description}
              onChange={(e) => setField("description", e.target.value)}
              placeholder="Search description"
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Category</label>
            <input
              type="text"
              value={filters.category}
              onChange={(e) => setField("category", e.target.value)}
              placeholder="e.g. Food"
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Subcategory</label>
            <input
              type="text"
              value={filters.subcategory}
              onChange={(e) => setField("subcategory", e.target.value)}
              placeholder="e.g. Groceries"
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Account</label>
            <input
              type="text"
              value={filters.account}
              onChange={(e) => setField("account", e.target.value)}
              placeholder="e.g. Checking"
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Card Holder</label>
            <ComboBox
              value={filters.cardholder}
              onChange={(v) => setField("cardholder", v)}
              suggestions={cardholderSuggestions}
              placeholder="e.g. 1234"
              className="border border-gray-300 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Recurring</label>
            <select
              value={filters.is_recurring}
              onChange={(e) => setField("is_recurring", e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All</option>
              <option value="true">Recurring only</option>
              <option value="false">Non-recurring only</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Category</label>
            <select
              value={filters.uncategorized}
              onChange={(e) => setField("uncategorized", e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All</option>
              <option value="true">Uncategorized only</option>
            </select>
          </div>
        </div>
        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Amount min</label>
            <input
              type="text"
              value={filters.amount_min}
              onChange={(e) => setField("amount_min", e.target.value)}
              placeholder="e.g. -50"
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Amount max</label>
            <input
              type="text"
              value={filters.amount_max}
              onChange={(e) => setField("amount_max", e.target.value)}
              placeholder="e.g. 0"
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex-1" />
          <div className="flex gap-2">
            <button
              type="submit"
              className="px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="px-4 py-1.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              Clear
            </button>
          </div>
        </div>
      </form>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
          {error}
        </div>
      )}

      {selectedIds.size > 0 && (
        <BulkEditBar
          count={selectedIds.size}
          onApply={handleBulkApply}
          onClear={() => setSelectedIds(new Set())}
          saving={bulkSaving}
          error={bulkError}
          eligibleForReEnrich={eligibleForReEnrich}
          onReEnrich={handleBulkReEnrich}
          reEnriching={bulkReEnriching}
          reEnrichError={bulkReEnrichError}
        />
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 w-10">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => {
                    if (allSelected) {
                      setSelectedIds(new Set());
                    } else {
                      setSelectedIds(new Set(allRows.map((r) => r.id)));
                    }
                  }}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
              </th>
              {COLUMNS.map(({ label, key, rightAlign }) => (
                <th
                  key={key}
                  className={`px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider ${rightAlign ? "text-right" : "text-left"}`}
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
              <th className="px-4 py-3 w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                  <div className="flex items-center justify-center gap-2">
                    <svg
                      className="animate-spin h-4 w-4 text-indigo-500"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
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
                    Loading…
                  </div>
                </td>
              </tr>
            ) : allRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">
                  No transactions found.
                </td>
              </tr>
            ) : (
              allRows.map((row) => {
                const { text, positive } = formatAmount(row.amount);
                const category = [row.category, row.subcategory].filter(Boolean).join(" / ");
                return (
                  <tr
                    key={row.id}
                    className={`cursor-pointer ${selectedIds.has(row.id) ? "bg-indigo-50" : "hover:bg-gray-50"}`}
                    onClick={() => setViewingTx(row)}
                  >
                    <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(row.id)}
                        onChange={() => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(row.id)) next.delete(row.id);
                            else next.add(row.id);
                            return next;
                          });
                        }}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-gray-600">{row.date}</td>
                    <td className="px-4 py-2 text-gray-800">
                      {row.description}
                      {row.is_recurring && (
                        <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-600">
                          recurring
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {row.merchant ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {category || <span className="text-gray-300">—</span>}
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-mono whitespace-nowrap ${
                        positive ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {text}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{row.account}</td>
                    <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setEditingTx(row)}
                        className="text-gray-400 hover:text-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
                        aria-label="Edit transaction"
                        title="Edit"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      {hasMore && !loading && (
        <div className="mt-4 flex items-center justify-center gap-4">
          {totalCount !== null && (
            <span className="text-sm text-gray-500">
              Showing {allRows.length.toLocaleString()} of {totalCount.toLocaleString()}
            </span>
          )}
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="flex items-center gap-2 px-5 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded hover:bg-gray-50 disabled:opacity-50"
          >
            {loadingMore ? (
              <>
                <svg
                  className="animate-spin h-4 w-4 text-gray-500"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
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
                Loading…
              </>
            ) : (
              "Load more"
            )}
          </button>
        </div>
      )}
    </div>
  );
}
