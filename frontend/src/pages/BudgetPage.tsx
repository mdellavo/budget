import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import HelpIcon from "../components/HelpIcon";
import {
  listBudgets,
  listAllCategories,
  createBudget,
  updateBudget,
  deleteBudget,
  getBudgetWizard,
  createBudgetsBatch,
} from "../api/client";
import type {
  BudgetItem,
  CategoryClassification,
  CategoryOption,
  WizardResponse,
  WizardSuggestion,
} from "../types";
import type { Data, Layout, Config } from "plotly.js";

declare const Plotly: {
  react: (el: HTMLElement, data: Data[], layout: Partial<Layout>, config?: Partial<Config>) => void;
};

function formatCurrency(amount: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    parseFloat(amount)
  );
}

function getMonths(): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

function monthDateRange(month: string): { date_from: string; date_to: string } {
  const [year, m] = month.split("-").map(Number);
  const lastDay = new Date(year, m, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date_from: `${month}-01`,
    date_to: `${year}-${pad(m)}-${pad(lastDay)}`,
  };
}

function severityColor(severity: BudgetItem["severity"]): string {
  if (severity === "over") return "bg-red-500";
  if (severity === "approaching") return "bg-amber-400";
  return "bg-indigo-500";
}

interface ProgressBarProps {
  pct: number;
  forecastPct: number | null;
  severity: BudgetItem["severity"];
}

function ProgressBar({ pct, forecastPct, severity }: ProgressBarProps) {
  const baseColor = severityColor(severity);
  const actualWidth = Math.min(pct, 100);
  const forecastWidth = forecastPct !== null ? Math.min(forecastPct, 100) : null;

  return (
    <div className="relative h-3 bg-gray-100 rounded-full overflow-hidden">
      {forecastWidth !== null && (
        <div
          className={`absolute inset-y-0 left-0 ${baseColor} opacity-30 rounded-full`}
          style={{ width: `${forecastWidth}%` }}
        />
      )}
      <div
        className={`absolute inset-y-0 left-0 ${baseColor} rounded-full`}
        style={{ width: `${actualWidth}%` }}
      />
    </div>
  );
}

interface BudgetFormProps {
  categoryOptions: CategoryOption[];
  onSave: (categoryId: number | null, subcategoryId: number | null, limit: string) => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}

function BudgetForm({ categoryOptions, onSave, onCancel, saving, error }: BudgetFormProps) {
  const [scope, setScope] = useState<"category" | "subcategory">("category");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [parentCategoryId, setParentCategoryId] = useState<string>("");
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<string>("");
  const [limit, setLimit] = useState("");

  // Unique categories
  const uniqueCategories = Array.from(
    new Map(categoryOptions.map((o) => [o.category_id, o])).values()
  );

  // Subcategories for selected parent
  const filteredSubs = categoryOptions.filter((o) => String(o.category_id) === parentCategoryId);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (scope === "category") {
      onSave(Number(selectedCategoryId), null, limit);
    } else {
      onSave(null, Number(selectedSubcategoryId), limit);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
      <h2 className="text-base font-semibold text-gray-900 mb-4">New Budget</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Scope */}
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              value="category"
              checked={scope === "category"}
              onChange={() => setScope("category")}
              className="text-indigo-600"
            />
            <span className="text-sm">Category</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              value="subcategory"
              checked={scope === "subcategory"}
              onChange={() => setScope("subcategory")}
              className="text-indigo-600"
            />
            <span className="text-sm">Subcategory</span>
          </label>
        </div>

        {scope === "category" ? (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select
              required
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Select a category…</option>
              {uniqueCategories.map((c) => (
                <option key={c.category_id} value={c.category_id}>
                  {c.category_name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Parent Category
              </label>
              <select
                required
                value={parentCategoryId}
                onChange={(e) => {
                  setParentCategoryId(e.target.value);
                  setSelectedSubcategoryId("");
                }}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Select a category…</option>
                {uniqueCategories.map((c) => (
                  <option key={c.category_id} value={c.category_id}>
                    {c.category_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Subcategory</label>
              <select
                required
                value={selectedSubcategoryId}
                onChange={(e) => setSelectedSubcategoryId(e.target.value)}
                disabled={!parentCategoryId}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
              >
                <option value="">Select a subcategory…</option>
                {filteredSubs.map((s) => (
                  <option key={s.subcategory_id} value={s.subcategory_id}>
                    {s.subcategory_name}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Monthly Limit ($)</label>
          <input
            type="number"
            required
            min="0.01"
            step="0.01"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder="e.g. 500"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {error && <div className="text-sm text-red-600">{error}</div>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 bg-white text-gray-700 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

interface BudgetCardProps {
  budget: BudgetItem;
  month: string;
  classification: CategoryClassification;
  onDelete: (id: number) => void;
  onUpdate: (id: number, limit: string) => Promise<void>;
}

function BudgetCard({ budget, month, classification, onDelete, onUpdate }: BudgetCardProps) {
  const [editing, setEditing] = useState(false);
  const [editLimit, setEditLimit] = useState(budget.amount_limit);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onUpdate(budget.id, editLimit);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const severityBadge =
    budget.severity === "over" ? (
      <span className="text-xs font-medium text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
        Over budget
      </span>
    ) : budget.severity === "approaching" ? (
      <span className="text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
        Approaching
      </span>
    ) : null;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-gray-900">{budget.name}</span>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
            {budget.scope}
          </span>
          {classification === "need" && (
            <span className="text-xs font-medium text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
              Need
            </span>
          )}
          {classification === "want" && (
            <span className="text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
              Want
            </span>
          )}
          {severityBadge}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          {editing ? (
            <>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={editLimit}
                onChange={(e) => setEditLimit(e.target.value)}
                className="w-24 border border-gray-300 rounded px-2 py-1 text-sm"
              />
              <button
                onClick={handleSave}
                disabled={saving}
                className="text-sm text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
              >
                {saving ? "…" : "Save"}
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setEditLimit(budget.amount_limit);
                }}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(true)}
                className="text-sm text-indigo-600 hover:text-indigo-800"
              >
                Edit
              </button>
              <button
                onClick={() => onDelete(budget.id)}
                className="text-sm text-red-500 hover:text-red-700"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      <ProgressBar pct={budget.pct} forecastPct={budget.forecast_pct} severity={budget.severity} />

      <div className="flex justify-between text-xs text-gray-500 mt-1">
        <span>
          {formatCurrency(budget.spent)} spent ({budget.pct}%)
          {budget.forecast !== null && budget.forecast !== budget.spent && (
            <span className="ml-1 text-gray-400">
              · {formatCurrency(budget.forecast)} forecasted (
              {budget.forecast_pct !== null ? `${budget.forecast_pct}%` : "—"})
            </span>
          )}
        </span>
        <div className="flex items-center gap-3">
          <Link
            to={(() => {
              const { date_from, date_to } = monthDateRange(month);
              const p = new URLSearchParams({ date_from, date_to });
              if (budget.scope === "category") p.set("category", budget.name);
              else p.set("subcategory", budget.name);
              return `/transactions?${p.toString()}`;
            })()}
            className="text-indigo-500 hover:text-indigo-700"
          >
            View transactions
          </Link>
          <span>{formatCurrency(budget.amount_limit)} limit</span>
        </div>
      </div>
    </div>
  );
}

interface WizardSectionProps {
  onClose: () => void;
  onCreated: () => void;
  classificationMap: Record<number, CategoryClassification>;
  subcategoryClassificationMap: Record<number, CategoryClassification>;
}

function WizardSection({
  onClose,
  onCreated,
  classificationMap,
  subcategoryClassificationMap,
}: WizardSectionProps) {
  const [scope, setScope] = useState<"category" | "subcategory">("category");
  const [wizardMonths, setWizardMonths] = useState(6);
  const [wizardData, setWizardData] = useState<WizardResponse | null>(null);
  const [wizardLoading, setWizardLoading] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [selections, setSelections] = useState<
    Record<number, { selected: boolean; limit: string }>
  >({});
  const [batchSaving, setBatchSaving] = useState(false);
  const [mode, setMode] = useState<"custom" | "503020">("custom");

  useEffect(() => {
    async function fetchWizard() {
      setMode("custom");
      setWizardLoading(true);
      setWizardError(null);
      try {
        const data = await getBudgetWizard(wizardMonths, scope);
        setWizardData(data);
        const initial: Record<number, { selected: boolean; limit: string }> = {};
        for (const item of data.items) {
          initial[item.id] = {
            selected: !item.already_budgeted,
            limit: item.avg_monthly,
          };
        }
        setSelections(initial);
      } catch (e: unknown) {
        setWizardError(e instanceof Error ? e.message : "Failed to load suggestions");
      } finally {
        setWizardLoading(false);
      }
    }
    fetchWizard();
  }, [scope, wizardMonths]);

  function toggleSelection(id: number) {
    setSelections((prev) => ({
      ...prev,
      [id]: { ...prev[id], selected: !prev[id].selected },
    }));
  }

  function setLimit(id: number, limit: string) {
    setSelections((prev) => ({ ...prev, [id]: { ...prev[id], limit } }));
  }

  // 50/30/20 calculations
  const income = wizardData ? parseFloat(wizardData.avg_monthly_income) : 0;
  const targetNeeds = income * 0.5;
  const targetWants = income * 0.3;
  const targetSavings = income * 0.2;

  let totalNeedsAvg = 0,
    totalWantsAvg = 0;
  if (wizardData) {
    for (const item of wizardData.items) {
      const c =
        (item.scope === "category"
          ? classificationMap[item.id]
          : subcategoryClassificationMap[item.id]) ?? null;
      const avg = parseFloat(item.avg_monthly);
      if (c === "need") totalNeedsAvg += avg;
      else if (c === "want") totalWantsAvg += avg;
    }
  }
  const needsScale =
    totalNeedsAvg > 0 && targetNeeds < totalNeedsAvg ? targetNeeds / totalNeedsAvg : 1;
  const wantsScale =
    totalWantsAvg > 0 && targetWants < totalWantsAvg ? targetWants / totalWantsAvg : 1;

  const unclassifiedCount = wizardData
    ? wizardData.items.filter(
        (item) =>
          ((item.scope === "category"
            ? classificationMap[item.id]
            : subcategoryClassificationMap[item.id]) ?? null) === null
      ).length
    : 0;

  function handleModeChange(newMode: "custom" | "503020") {
    setMode(newMode);
    if (!wizardData) return;
    setSelections((prev) => {
      const next = { ...prev };
      for (const item of wizardData.items) {
        if (!next[item.id]) continue;
        let limit: string;
        if (newMode === "503020") {
          const c =
            (item.scope === "category"
              ? classificationMap[item.id]
              : subcategoryClassificationMap[item.id]) ?? null;
          const avg = parseFloat(item.avg_monthly);
          if (c === "need") limit = (avg * needsScale).toFixed(2);
          else if (c === "want") limit = (avg * wantsScale).toFixed(2);
          else limit = item.avg_monthly;
        } else {
          limit = item.avg_monthly;
        }
        next[item.id] = { ...next[item.id], limit };
      }
      return next;
    });
  }

  const selectedItems = wizardData
    ? wizardData.items.filter((item) => !item.already_budgeted && selections[item.id]?.selected)
    : [];

  async function handleCreate() {
    if (selectedItems.length === 0) return;
    setBatchSaving(true);
    try {
      const batchItems = selectedItems.map((item: WizardSuggestion) => ({
        category_id: item.scope === "category" ? item.id : null,
        subcategory_id: item.scope === "subcategory" ? item.id : null,
        amount_limit: selections[item.id]?.limit ?? item.avg_monthly,
      }));
      await createBudgetsBatch(batchItems);
      onCreated();
    } catch (e: unknown) {
      setWizardError(e instanceof Error ? e.message : "Failed to create budgets");
    } finally {
      setBatchSaving(false);
    }
  }

  // Sort items for 503020 mode: needs(0) → wants(1) → unclassified(2)
  const sortedItems =
    mode === "503020" && wizardData
      ? [...wizardData.items].sort((a, b) => {
          const rank = (item: WizardSuggestion) => {
            const c =
              (item.scope === "category"
                ? classificationMap[item.id]
                : subcategoryClassificationMap[item.id]) ?? null;
            if (c === "need") return 0;
            if (c === "want") return 1;
            return 2;
          };
          return rank(a) - rank(b);
        })
      : (wizardData?.items ?? []);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
      <h2 className="text-base font-semibold text-gray-900 mb-4">Budget Wizard</h2>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-6 mb-4">
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              value="category"
              checked={scope === "category"}
              onChange={() => setScope("category")}
              className="text-indigo-600"
            />
            <span className="text-sm">Category</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              value="subcategory"
              checked={scope === "subcategory"}
              onChange={() => setScope("subcategory")}
              className="text-indigo-600"
            />
            <span className="text-sm">Subcategory</span>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Look back:</span>
          <select
            value={wizardMonths}
            onChange={(e) => setWizardMonths(Number(e.target.value))}
            className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {[3, 6, 12, 24].map((n) => (
              <option key={n} value={n}>
                {n} months
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          <button
            type="button"
            onClick={() => handleModeChange("custom")}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              mode === "custom"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Custom
          </button>
          <button
            type="button"
            onClick={() => handleModeChange("503020")}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              mode === "503020"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            50/30/20
          </button>
        </div>
      </div>

      {/* Status line */}
      {wizardData && !wizardLoading && (
        <p className="text-sm text-gray-500 mb-4">
          Analyzing {wizardData.months_analyzed} months · avg income{" "}
          {formatCurrency(wizardData.avg_monthly_income)}/mo
        </p>
      )}

      {wizardLoading && <div className="text-sm text-gray-400 mb-4">Loading…</div>}

      {wizardError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3 mb-4">
          {wizardError}
        </div>
      )}

      {/* 50/30/20 summary panel */}
      {mode === "503020" && wizardData && !wizardLoading && (
        <div className="mb-5">
          {income === 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
              No income data found. Add income transactions to use 50/30/20 targets.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {/* Needs card */}
              <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
                <div className="text-xs font-semibold text-indigo-700 mb-1">Needs (50%)</div>
                <div className="text-sm font-medium text-indigo-900 mb-2">
                  {formatCurrency(String(targetNeeds))}/mo
                </div>
                <div className="h-1.5 bg-indigo-100 rounded-full overflow-hidden mb-1">
                  <div
                    className="h-full bg-indigo-500 rounded-full"
                    style={{
                      width: `${Math.min((totalNeedsAvg / targetNeeds) * 100, 100)}%`,
                    }}
                  />
                </div>
                <div className="text-xs text-indigo-600">
                  {totalNeedsAvg <= targetNeeds
                    ? `${formatCurrency(String(targetNeeds - totalNeedsAvg))} under target`
                    : `${formatCurrency(String(totalNeedsAvg - targetNeeds))} over target`}
                </div>
              </div>
              {/* Wants card */}
              <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                <div className="text-xs font-semibold text-amber-700 mb-1">Wants (30%)</div>
                <div className="text-sm font-medium text-amber-900 mb-2">
                  {formatCurrency(String(targetWants))}/mo
                </div>
                <div className="h-1.5 bg-amber-100 rounded-full overflow-hidden mb-1">
                  <div
                    className="h-full bg-amber-400 rounded-full"
                    style={{
                      width: `${Math.min((totalWantsAvg / targetWants) * 100, 100)}%`,
                    }}
                  />
                </div>
                <div className="text-xs text-amber-600">
                  {totalWantsAvg <= targetWants
                    ? `${formatCurrency(String(targetWants - totalWantsAvg))} under target`
                    : `${formatCurrency(String(totalWantsAvg - targetWants))} over target`}
                </div>
              </div>
              {/* Savings card */}
              <div className="bg-green-50 border border-green-100 rounded-lg p-3">
                <div className="text-xs font-semibold text-green-700 mb-1">
                  Savings &amp; Debt (20%)
                </div>
                <div className="text-sm font-medium text-green-900 mb-2">
                  {formatCurrency(String(targetSavings))}/mo
                </div>
                <div className="text-xs text-green-600">
                  Savings, investments &amp; extra debt payments — not tracked as budgets here
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Unclassified warning */}
      {mode === "503020" && unclassifiedCount > 0 && wizardData && !wizardLoading && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-600 mb-4">
          {unclassifiedCount} item{unclassifiedCount !== 1 ? "s" : ""} without a Need/Want
          classification — their limits use average spending. Classify them in{" "}
          <Link to="/categories" className="text-indigo-600 hover:text-indigo-800 underline">
            Categories →
          </Link>
        </div>
      )}

      {/* Suggestion rows */}
      {wizardData && !wizardLoading && wizardData.items.length === 0 && (
        <div className="text-sm text-gray-400 mb-4">
          No spending data found for the selected period.
        </div>
      )}

      {wizardData && !wizardLoading && wizardData.items.length > 0 && (
        <div className="space-y-2 mb-5">
          {sortedItems.map((item) => {
            const sel = selections[item.id];
            const isDisabled = item.already_budgeted;
            const classification =
              (item.scope === "category"
                ? classificationMap[item.id]
                : subcategoryClassificationMap[item.id]) ?? null;
            return (
              <div
                key={item.id}
                className={`flex items-center gap-3 py-2 px-3 rounded-md ${isDisabled ? "bg-gray-50 opacity-60" : "hover:bg-gray-50"}`}
              >
                <input
                  type="checkbox"
                  checked={isDisabled ? false : (sel?.selected ?? false)}
                  disabled={isDisabled}
                  onChange={() => toggleSelection(item.id)}
                  className="h-4 w-4 text-indigo-600 rounded"
                />
                <span className="flex-1 text-sm font-medium text-gray-800 flex items-center gap-2">
                  {item.name}
                  {mode === "503020" &&
                    (classification === "need" ? (
                      <span className="text-xs font-medium text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded-full">
                        Need
                      </span>
                    ) : classification === "want" ? (
                      <span className="text-xs font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">
                        Want
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">
                        —
                      </span>
                    ))}
                </span>
                <span className="text-xs text-gray-400 w-28 text-right">
                  avg {formatCurrency(item.avg_monthly)}/mo
                </span>
                {item.pct_of_income !== null && (
                  <span className="text-xs text-gray-400 w-20 text-right">
                    {item.pct_of_income}% income
                  </span>
                )}
                {isDisabled ? (
                  <span className="text-xs text-gray-400 italic w-32 text-right">
                    already budgeted
                  </span>
                ) : (
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={sel?.limit ?? item.avg_monthly}
                    onChange={(e) => setLimit(item.id, e.target.value)}
                    className="w-24 border border-gray-300 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleCreate}
          disabled={batchSaving || selectedItems.length === 0}
          className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50"
        >
          {batchSaving
            ? "Creating…"
            : `Create ${selectedItems.length} Budget${selectedItems.length !== 1 ? "s" : ""}`}
        </button>
        <button
          onClick={onClose}
          className="px-4 py-2 bg-white text-gray-700 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

interface HistoricalChartProps {
  budgets: BudgetItem[];
  months: string[];
  historicalData: Record<string, BudgetItem[]>;
}

function HistoricalChart({ budgets, months, historicalData }: HistoricalChartProps) {
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!divRef.current || budgets.length === 0) return;

    const traces: Data[] = [];

    // Gray limit bars per budget
    budgets.forEach((b) => {
      const x: string[] = [];
      const y: number[] = [];
      months.forEach((m) => {
        const row = (historicalData[m] ?? []).find((r) => r.id === b.id);
        if (row) {
          x.push(m);
          y.push(parseFloat(row.amount_limit));
        }
      });
      if (x.length > 0) {
        traces.push({
          type: "bar",
          name: `${b.name} limit`,
          x,
          y,
          marker: { color: "rgba(156,163,175,0.5)" },
          legendgroup: b.name,
          showlegend: false,
        } as Data);
      }
    });

    // Colored spent bars per budget
    budgets.forEach((b) => {
      const x: string[] = [];
      const y: number[] = [];
      months.forEach((m) => {
        const row = (historicalData[m] ?? []).find((r) => r.id === b.id);
        if (row) {
          x.push(m);
          y.push(parseFloat(row.spent));
        }
      });
      if (x.length > 0) {
        traces.push({
          type: "bar",
          name: b.name,
          x,
          y,
          legendgroup: b.name,
        } as Data);
      }
    });

    const layout: Partial<Layout> = {
      barmode: "group",
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      margin: { l: 50, r: 20, t: 20, b: 60 },
      legend: { orientation: "h", y: -0.2 },
      yaxis: { title: { text: "Amount ($)" } },
    };

    const config: Partial<Config> = { responsive: true, displayModeBar: false };

    Plotly.react(divRef.current, traces, layout, config);
  }, [budgets, months, historicalData]);

  return <div ref={divRef} style={{ width: "100%", height: 380 }} />;
}

export default function BudgetPage() {
  const MONTHS = getMonths();
  const [searchParams, setSearchParams] = useSearchParams();
  const month = searchParams.get("month") ?? MONTHS[MONTHS.length - 1];

  const [budgets, setBudgets] = useState<BudgetItem[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const [classificationMap, setClassificationMap] = useState<
    Record<number, CategoryClassification>
  >({});
  const [subcategoryClassificationMap, setSubcategoryClassificationMap] = useState<
    Record<number, CategoryClassification>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSaving, setFormSaving] = useState(false);

  const [showWizard, setShowWizard] = useState(false);

  const [historicalData, setHistoricalData] = useState<Record<string, BudgetItem[]>>({});
  const [historicalLoading, setHistoricalLoading] = useState(false);

  async function loadBudgets(m: string) {
    setLoading(true);
    setError(null);
    try {
      const [budgetRes, catRes] = await Promise.all([listBudgets(m), listAllCategories()]);
      setBudgets(budgetRes.items);
      setCategoryOptions(catRes.items);
      // Build category_id → classification map (deduplicated)
      const cmap: Record<number, CategoryClassification> = {};
      for (const opt of catRes.items) {
        if (!(opt.category_id in cmap)) {
          cmap[opt.category_id] = opt.classification;
        }
      }
      setClassificationMap(cmap);
      // Build subcategory_id → classification map
      const scmap: Record<number, CategoryClassification> = {};
      for (const opt of catRes.items) {
        scmap[opt.subcategory_id] = opt.subcategory_classification;
      }
      setSubcategoryClassificationMap(scmap);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load budgets");
    } finally {
      setLoading(false);
    }
  }

  async function loadHistorical(currentBudgets: BudgetItem[]) {
    if (currentBudgets.length === 0) return;
    setHistoricalLoading(true);
    try {
      const results = await Promise.all(MONTHS.map((m) => listBudgets(m)));
      const map: Record<string, BudgetItem[]> = {};
      MONTHS.forEach((m, i) => {
        map[m] = results[i].items;
      });
      setHistoricalData(map);
    } catch {
      // ignore chart load errors
    } finally {
      setHistoricalLoading(false);
    }
  }

  useEffect(() => {
    loadBudgets(month);
  }, [month]);

  useEffect(() => {
    if (!loading && budgets.length > 0) {
      loadHistorical(budgets);
    }
  }, [loading, budgets.length]);

  async function handleCreate(
    categoryId: number | null,
    subcategoryId: number | null,
    limit: string
  ) {
    setFormSaving(true);
    setFormError(null);
    try {
      await createBudget({
        category_id: categoryId,
        subcategory_id: subcategoryId,
        amount_limit: limit,
      });
      setShowForm(false);
      await loadBudgets(month);
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "Failed to create budget");
    } finally {
      setFormSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this budget?")) return;
    try {
      await deleteBudget(id);
      await loadBudgets(month);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete budget");
    }
  }

  async function handleUpdate(id: number, limit: string) {
    await updateBudget(id, { amount_limit: limit });
    await loadBudgets(month);
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">Budgets</h1>
            <HelpIcon section="budgets" />
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {new Date(month + "-02").toLocaleString("default", { month: "long", year: "numeric" })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={month}
            onChange={(e) => setSearchParams({ month: e.target.value })}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {MONTHS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {!showForm && !showWizard && (
            <>
              <button
                onClick={() => setShowWizard(true)}
                className="px-4 py-2 bg-white text-indigo-600 text-sm border border-indigo-300 rounded-md hover:bg-indigo-50"
              >
                Generate Budgets
              </button>
              <button
                onClick={() => setShowForm(true)}
                className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700"
              >
                + Add Budget
              </button>
            </>
          )}
        </div>
      </div>

      {/* Wizard section */}
      {showWizard && (
        <WizardSection
          onClose={() => setShowWizard(false)}
          onCreated={() => {
            setShowWizard(false);
            loadBudgets(month);
          }}
          classificationMap={classificationMap}
          subcategoryClassificationMap={subcategoryClassificationMap}
        />
      )}

      {/* Inline form */}
      {showForm && (
        <BudgetForm
          categoryOptions={categoryOptions}
          onSave={handleCreate}
          onCancel={() => {
            setShowForm(false);
            setFormError(null);
          }}
          saving={formSaving}
          error={formError}
        />
      )}

      {/* Loading / error */}
      {loading && <div className="text-gray-500">Loading…</div>}
      {error && (
        <div className="text-red-600 bg-red-50 border border-red-200 rounded p-4 mb-4">{error}</div>
      )}

      {/* Budget list */}
      {!loading && budgets.length === 0 && (
        <div className="text-gray-400 text-sm">
          No budgets yet. Click &ldquo;+ Add Budget&rdquo; to create one.
        </div>
      )}

      {budgets.length > 0 &&
        (() => {
          // Resolve classification per budget (category or subcategory scope)
          function getClassification(b: BudgetItem): CategoryClassification {
            if (b.scope === "category")
              return b.category_id != null ? (classificationMap[b.category_id] ?? null) : null;
            return b.subcategory_id != null
              ? (subcategoryClassificationMap[b.subcategory_id] ?? null)
              : null;
          }
          // Compute needs vs wants totals
          const needSpent = budgets
            .filter((b) => getClassification(b) === "need")
            .reduce((sum, b) => sum + parseFloat(b.spent), 0);
          const needLimit = budgets
            .filter((b) => getClassification(b) === "need")
            .reduce((sum, b) => sum + parseFloat(b.amount_limit), 0);
          const wantSpent = budgets
            .filter((b) => getClassification(b) === "want")
            .reduce((sum, b) => sum + parseFloat(b.spent), 0);
          const wantLimit = budgets
            .filter((b) => getClassification(b) === "want")
            .reduce((sum, b) => sum + parseFloat(b.amount_limit), 0);
          const hasClassified = needLimit > 0 || wantLimit > 0;

          return (
            <>
              {hasClassified && (
                <div className="mb-4 bg-white border border-gray-200 rounded-lg p-4 space-y-2">
                  {needLimit > 0 && (
                    <div className="flex items-center gap-3">
                      <span className="w-12 text-xs font-medium text-indigo-700">Needs</span>
                      <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 rounded-full"
                          style={{ width: `${Math.min((needSpent / needLimit) * 100, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 whitespace-nowrap">
                        {formatCurrency(String(needSpent))} / {formatCurrency(String(needLimit))} (
                        {Math.round((needSpent / needLimit) * 100)}%)
                      </span>
                    </div>
                  )}
                  {wantLimit > 0 && (
                    <div className="flex items-center gap-3">
                      <span className="w-12 text-xs font-medium text-amber-700">Wants</span>
                      <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-400 rounded-full"
                          style={{ width: `${Math.min((wantSpent / wantLimit) * 100, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 whitespace-nowrap">
                        {formatCurrency(String(wantSpent))} / {formatCurrency(String(wantLimit))} (
                        {Math.round((wantSpent / wantLimit) * 100)}%)
                      </span>
                    </div>
                  )}
                </div>
              )}
              <div className="space-y-4">
                {budgets.map((b) => (
                  <BudgetCard
                    key={b.id}
                    budget={b}
                    month={month}
                    classification={
                      b.scope === "category"
                        ? b.category_id != null
                          ? (classificationMap[b.category_id] ?? null)
                          : null
                        : b.subcategory_id != null
                          ? (subcategoryClassificationMap[b.subcategory_id] ?? null)
                          : null
                    }
                    onDelete={handleDelete}
                    onUpdate={handleUpdate}
                  />
                ))}
              </div>
            </>
          );
        })()}

      {/* Historical chart */}
      {budgets.length > 0 && !historicalLoading && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Last 6 Months</h2>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <HistoricalChart budgets={budgets} months={MONTHS} historicalData={historicalData} />
          </div>
        </div>
      )}
    </div>
  );
}
