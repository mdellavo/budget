import type { AccountsResponse, CategoriesResponse, ImportsResponse, ImportCsvResponse, ImportProgress, MerchantsResponse, MonthListResponse, MonthlyReport, OverviewData, RecurringData, TransactionItem, TransactionsResponse } from "../types";

const BASE = "/api";

export class ApiResponseError extends Error {
  constructor(public status: number, public detail: string) {
    super(`API ${status}: ${detail}`);
    this.name = "ApiResponseError";
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {}
    throw new ApiResponseError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export interface TransactionFilters {
  date_from?: string;
  date_to?: string;
  merchant?: string;
  description?: string;
  amount_min?: string;
  amount_max?: string;
  category?: string;
  subcategory?: string;
  account?: string;
  import_id?: number;
  is_recurring?: boolean;
  uncategorized?: boolean;
  after?: number;
  limit?: number;
  sort_by?: "date" | "amount" | "description" | "merchant" | "category" | "account";
  sort_dir?: "asc" | "desc";
}

export async function listTransactions(
  filters: TransactionFilters = {}
): Promise<TransactionsResponse> {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(filters)) {
    if (val !== undefined && val !== "") params.set(key, String(val));
  }
  const qs = params.toString();
  return handleResponse<TransactionsResponse>(
    await fetch(`${BASE}/transactions${qs ? `?${qs}` : ""}`)
  );
}

export interface MerchantFilters {
  name?: string;
  location?: string;
  after?: number;
  limit?: number;
  sort_by?: "name" | "transaction_count" | "total_amount";
  sort_dir?: "asc" | "desc";
}

export async function listMerchants(
  filters: MerchantFilters = {}
): Promise<MerchantsResponse> {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(filters)) {
    if (val !== undefined && val !== "") params.set(key, String(val));
  }
  const qs = params.toString();
  return handleResponse<MerchantsResponse>(
    await fetch(`${BASE}/merchants${qs ? `?${qs}` : ""}`)
  );
}

export interface CategoryFilters {
  date_from?: string;
  date_to?: string;
  category?: string;
  subcategory?: string;
  sort_by?: "category" | "subcategory" | "transaction_count" | "total_amount";
  sort_dir?: "asc" | "desc";
}

export async function listCategories(
  filters: CategoryFilters = {}
): Promise<CategoriesResponse> {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(filters)) {
    if (val !== undefined && val !== "") params.set(key, String(val));
  }
  const qs = params.toString();
  return handleResponse<CategoriesResponse>(
    await fetch(`${BASE}/categories${qs ? `?${qs}` : ""}`)
  );
}

export interface AccountFilters {
  name?: string;
  institution?: string;
  account_type?: string;
  after?: number;
  limit?: number;
  sort_by?: "name" | "institution" | "account_type" | "created_at" | "transaction_count" | "total_amount";
  sort_dir?: "asc" | "desc";
}

export async function listAccounts(
  filters: AccountFilters = {}
): Promise<AccountsResponse> {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(filters)) {
    if (val !== undefined && val !== "") params.set(key, String(val));
  }
  const qs = params.toString();
  return handleResponse<AccountsResponse>(
    await fetch(`${BASE}/accounts${qs ? `?${qs}` : ""}`)
  );
}

export interface ImportFilters {
  filename?: string;
  account?: string;
  after?: number;
  limit?: number;
  sort_by?: "filename" | "account" | "imported_at" | "row_count" | "transaction_count";
  sort_dir?: "asc" | "desc";
}

export async function listImports(
  filters: ImportFilters = {}
): Promise<ImportsResponse> {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(filters)) {
    if (val !== undefined && val !== "") params.set(key, String(val));
  }
  const qs = params.toString();
  return handleResponse<ImportsResponse>(
    await fetch(`${BASE}/imports${qs ? `?${qs}` : ""}`)
  );
}

export async function getOverview(): Promise<OverviewData> {
  return handleResponse<OverviewData>(await fetch(`${BASE}/overview`));
}

export async function getRecurring(): Promise<RecurringData> {
  return handleResponse<RecurringData>(await fetch(`${BASE}/recurring`));
}

export async function listMonths(): Promise<MonthListResponse> {
  return handleResponse<MonthListResponse>(await fetch(`${BASE}/monthly`));
}

export async function getMonthlyReport(month: string): Promise<MonthlyReport> {
  return handleResponse<MonthlyReport>(await fetch(`${BASE}/monthly/${month}`));
}

export async function getImportProgress(importId: number): Promise<ImportProgress> {
  return handleResponse<ImportProgress>(
    await fetch(`${BASE}/imports/${importId}/progress`)
  );
}

export interface ParseQueryResponse {
  filters: TransactionFilters;
  explanation: string;
}

export async function parseQuery(query: string): Promise<ParseQueryResponse> {
  return handleResponse<ParseQueryResponse>(
    await fetch(`${BASE}/ai/parse-query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    })
  );
}

export interface TransactionUpdateBody {
  description: string;
  merchant_name: string | null;
  category: string | null;
  subcategory: string | null;
  notes: string | null;
}

export async function updateTransaction(
  id: number,
  body: TransactionUpdateBody
): Promise<TransactionItem> {
  return handleResponse<TransactionItem>(
    await fetch(`${BASE}/transactions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

export async function importCsv(
  file: File,
  accountName: string,
  accountType?: string,
): Promise<ImportCsvResponse> {
  const form = new FormData();
  form.append("file", file);
  form.append("account_name", accountName);
  if (accountType) form.append("account_type", accountType);
  // Do NOT set Content-Type — fetch sets the multipart boundary automatically
  return handleResponse<ImportCsvResponse>(
    await fetch(`${BASE}/import-csv`, { method: "POST", body: form })
  );
}
