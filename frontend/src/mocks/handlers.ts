import { http, HttpResponse } from "msw";

/**
 * Default MSW handlers — return minimal empty responses so component tests
 * don't fail on unhandled API calls.  Individual tests override these with
 * server.use(...) for test-specific data.
 */
export const handlers = [
  http.get("/api/transactions", () =>
    HttpResponse.json({ items: [], has_more: false, next_cursor: null, total_count: 0 })
  ),
  http.get("/api/merchants", () =>
    HttpResponse.json({ items: [], has_more: false, next_cursor: null })
  ),
  http.get("/api/accounts", () =>
    HttpResponse.json({ items: [], has_more: false, next_cursor: null })
  ),
  http.get("/api/categories", () => HttpResponse.json({ items: [] })),
  http.get("/api/imports", () =>
    HttpResponse.json({ items: [], has_more: false, next_cursor: null })
  ),
  http.get("/api/overview", () =>
    HttpResponse.json({
      transaction_count: 0,
      income: "0",
      expenses: "0",
      net: "0",
      savings_rate: null,
      expense_breakdown: [],
      sankey: { income_sources: [], expense_categories: [] },
    })
  ),
  http.get("/api/recurring", () => HttpResponse.json({ items: [] })),
  http.get("/api/monthly", () => HttpResponse.json({ months: [] })),
  http.get("/api/cardholders", () =>
    HttpResponse.json({ items: [], has_more: false, next_cursor: null })
  ),
  http.get("/api/category-trends", () => HttpResponse.json({ items: [] })),
];
