import type {
  AccountsResponse,
  CardHolderItem,
  CardHoldersResponse,
  CategoriesResponse,
  CategoryTrendsResponse,
  ImportsResponse,
  ImportCsvResponse,
  ImportProgress,
  MerchantItem,
  MerchantsResponse,
  MonthListResponse,
  MonthlyReport,
  OverviewData,
  RecurringData,
  TransactionItem,
  TransactionsResponse,
} from "../types";

const BASE = "/api";

export class ApiResponseError extends Error {
  constructor(
    public status: number,
    public detail: string
  ) {
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
    } catch {} // eslint-disable-line no-empty
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
  cardholder?: string;
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

export async function getMerchant(id: number): Promise<MerchantItem> {
  return handleResponse<MerchantItem>(await fetch(`${BASE}/merchants/${id}`));
}

export interface MerchantUpdateBody {
  name: string;
  location: string | null;
}

export async function updateMerchant(id: number, body: MerchantUpdateBody): Promise<MerchantItem> {
  return handleResponse<MerchantItem>(
    await fetch(`${BASE}/merchants/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

export async function listMerchants(filters: MerchantFilters = {}): Promise<MerchantsResponse> {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(filters)) {
    if (val !== undefined && val !== "") params.set(key, String(val));
  }
  const qs = params.toString();
  return handleResponse<MerchantsResponse>(await fetch(`${BASE}/merchants${qs ? `?${qs}` : ""}`));
}

export interface CategoryFilters {
  date_from?: string;
  date_to?: string;
  category?: string;
  subcategory?: string;
  sort_by?: "category" | "subcategory" | "transaction_count" | "total_amount";
  sort_dir?: "asc" | "desc";
}

export async function listCategories(filters: CategoryFilters = {}): Promise<CategoriesResponse> {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(filters)) {
    if (val !== undefined && val !== "") params.set(key, String(val));
  }
  const qs = params.toString();
  return handleResponse<CategoriesResponse>(await fetch(`${BASE}/categories${qs ? `?${qs}` : ""}`));
}

export interface AccountFilters {
  name?: string;
  institution?: string;
  account_type?: string;
  after?: number;
  limit?: number;
  sort_by?:
    | "name"
    | "institution"
    | "account_type"
    | "created_at"
    | "transaction_count"
    | "total_amount";
  sort_dir?: "asc" | "desc";
}

export async function listAccounts(filters: AccountFilters = {}): Promise<AccountsResponse> {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(filters)) {
    if (val !== undefined && val !== "") params.set(key, String(val));
  }
  const qs = params.toString();
  return handleResponse<AccountsResponse>(await fetch(`${BASE}/accounts${qs ? `?${qs}` : ""}`));
}

export interface ImportFilters {
  filename?: string;
  account?: string;
  after?: number;
  limit?: number;
  sort_by?: "filename" | "account" | "imported_at" | "row_count" | "transaction_count";
  sort_dir?: "asc" | "desc";
}

export async function listImports(filters: ImportFilters = {}): Promise<ImportsResponse> {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(filters)) {
    if (val !== undefined && val !== "") params.set(key, String(val));
  }
  const qs = params.toString();
  return handleResponse<ImportsResponse>(await fetch(`${BASE}/imports${qs ? `?${qs}` : ""}`));
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
  return handleResponse<ImportProgress>(await fetch(`${BASE}/imports/${importId}/progress`));
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

export interface CardHolderFilters {
  name?: string;
  card_number?: string;
  after?: number;
  limit?: number;
  sort_by?: "name" | "card_number" | "transaction_count" | "total_amount";
  sort_dir?: "asc" | "desc";
}

export async function listCardHolders(
  filters: CardHolderFilters = {}
): Promise<CardHoldersResponse> {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(filters)) {
    if (val !== undefined && val !== "") params.set(key, String(val));
  }
  const qs = params.toString();
  return handleResponse<CardHoldersResponse>(
    await fetch(`${BASE}/cardholders${qs ? `?${qs}` : ""}`)
  );
}

export interface CardHolderUpdateBody {
  name: string | null;
  card_number: string | null;
}

export async function updateCardHolder(
  id: number,
  body: CardHolderUpdateBody
): Promise<CardHolderItem> {
  return handleResponse<CardHolderItem>(
    await fetch(`${BASE}/cardholders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

export interface TransactionUpdateBody {
  description: string;
  merchant_name: string | null;
  category: string | null;
  subcategory: string | null;
  notes: string | null;
  card_number?: string | null;
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

export interface MergeGroupMember {
  id: number;
  name: string;
  location: string | null;
  transaction_count: number;
}

export interface MergeGroup {
  canonical_name: string;
  canonical_location: string | null;
  members: MergeGroupMember[];
}

export interface FindDuplicatesResponse {
  groups: MergeGroup[];
}

export interface MerchantMergeBody {
  canonical_name: string;
  canonical_location: string | null;
  merchant_ids: number[];
}

export interface MergedMerchantResult {
  id: number;
  name: string;
  location: string | null;
  transaction_count: number;
}

export async function findDuplicateMerchants(): Promise<FindDuplicatesResponse> {
  return handleResponse<FindDuplicatesResponse>(
    await fetch(`${BASE}/ai/find-duplicate-merchants`, { method: "POST" })
  );
}

export async function mergeMerchants(body: MerchantMergeBody): Promise<MergedMerchantResult> {
  return handleResponse<MergedMerchantResult>(
    await fetch(`${BASE}/merchants/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

export interface ReEnrichResponse {
  items: TransactionItem[];
}

export async function reEnrichTransactions(ids: number[]): Promise<ReEnrichResponse> {
  return handleResponse<ReEnrichResponse>(
    await fetch(`${BASE}/transactions/re-enrich`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction_ids: ids }),
    })
  );
}

export async function reEnrichImport(
  importId: number
): Promise<{ status: string; csv_import_id: number }> {
  return handleResponse(await fetch(`${BASE}/imports/${importId}/re-enrich`, { method: "POST" }));
}

export async function abortImport(
  importId: number
): Promise<{ status: string; csv_import_id: number }> {
  return handleResponse(await fetch(`${BASE}/imports/${importId}/abort`, { method: "POST" }));
}

export interface CategoryTrendFilters {
  date_from?: string; // "YYYY-MM"
  date_to?: string; // "YYYY-MM"
}

export async function getCategoryTrends(
  filters: CategoryTrendFilters = {}
): Promise<CategoryTrendsResponse> {
  const params = new URLSearchParams();
  if (filters.date_from) params.set("date_from", filters.date_from);
  if (filters.date_to) params.set("date_to", filters.date_to);
  const qs = params.toString();
  return handleResponse<CategoryTrendsResponse>(
    await fetch(`${BASE}/category-trends${qs ? `?${qs}` : ""}`)
  );
}

export async function importCsv(
  file: File,
  accountName: string,
  accountType?: string
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
