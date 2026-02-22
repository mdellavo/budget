export interface Account {
  id: number;
  name: string;
  institution: string | null;
  account_type: string | null;
  created_at: string;
}

export interface Transaction {
  id: number;
  account_id: number;
  csv_import_id: number | null;
  date: string;
  description: string;
  amount: string;
  merchant_id: number | null;
  subcategory_id: number | null;
  notes: string | null;
  created_at: string;
}

export interface TransactionItem {
  id: number;
  date: string;
  description: string;
  amount: string;
  account_id: number;
  account: string;
  merchant: string | null;
  category: string | null;
  subcategory: string | null;
  notes: string | null;
  is_recurring: boolean;
}

export interface TransactionsResponse {
  items: TransactionItem[];
  has_more: boolean;
  next_cursor: number | null;
  total_count: number;
}

export interface ColumnMapping {
  description: number | null;
  date: number | null;
  amount: number | null;
}

export interface MerchantItem {
  id: number;
  name: string;
  location: string | null;
  transaction_count: number;
  total_amount: string;
}

export interface MerchantsResponse {
  items: MerchantItem[];
  has_more: boolean;
  next_cursor: number | null;
}

export interface AccountItem {
  id: number;
  name: string;
  institution: string | null;
  account_type: string | null;
  created_at: string;
  transaction_count: number;
  total_amount: string;
}

export interface AccountsResponse {
  items: AccountItem[];
  has_more: boolean;
  next_cursor: number | null;
}

export interface CategoryItem {
  category: string;
  subcategory: string;
  transaction_count: number;
  total_amount: string;
}

export interface CategoriesResponse {
  items: CategoryItem[];
}

export interface ImportItem {
  id: number;
  filename: string;
  account: string | null;
  imported_at: string;
  row_count: number;
  enriched_rows: number;
  transaction_count: number;
  status: "in-progress" | "complete";
}

export interface ImportsResponse {
  items: ImportItem[];
  has_more: boolean;
  next_cursor: number | null;
}

export interface ImportCsvResponse {
  csv_import_id: number;
  filename: string;
  rows_imported: number;
  columns: string[];
  column_mapping: ColumnMapping;
  status: "processing";
}

export interface ImportProgress {
  csv_import_id: number;
  row_count: number;
  enriched_rows: number;
  complete: boolean;
}

export interface RecurringItem {
  merchant: string;
  merchant_id: number | null;
  category: string | null;
  amount: string; // median absolute value, positive
  frequency: "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";
  occurrences: number;
  last_charge: string; // ISO date
  next_estimated: string; // ISO date
  monthly_cost: string; // monthly equivalent, positive
}

export interface RecurringData {
  items: RecurringItem[];
}

export interface MonthListResponse {
  months: string[];
}

export interface SubcategoryBreakdown {
  subcategory: string;
  total: string;
}

export interface CategoryBreakdown {
  category: string;
  total: string;
  subcategories: SubcategoryBreakdown[];
}

export interface MonthlyReport {
  month: string;
  summary: {
    transaction_count: number;
    income: string;
    expenses: string;
    net: string;
    savings_rate: number | null;
  };
  category_breakdown: CategoryBreakdown[];
}

export interface SankeyNode {
  name: string;
  amount: string; // numeric string, may be negative for expense_categories
}

export interface OverviewData {
  transaction_count: number;
  income: string;
  expenses: string;
  net: string;
  savings_rate: number | null;
  expense_breakdown: SankeyNode[];
  sankey: {
    income_sources: SankeyNode[];
    expense_categories: SankeyNode[];
  };
}
