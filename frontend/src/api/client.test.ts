import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import {
  ApiResponseError,
  listTransactions,
  listMerchants,
  updateTransaction,
  parseQuery,
} from "./client";

// MSW server lifecycle is managed in test-setup.ts.
// Each test that needs a specific response calls server.use() to override
// the default handler; afterEach in test-setup.ts calls server.resetHandlers()
// to restore defaults.

// ---------------------------------------------------------------------------
// ApiResponseError
// ---------------------------------------------------------------------------

describe("ApiResponseError", () => {
  it("exposes status, detail, and a formatted message", () => {
    const err = new ApiResponseError(404, "Not found");
    expect(err.status).toBe(404);
    expect(err.detail).toBe("Not found");
    expect(err.message).toBe("API 404: Not found");
    expect(err.name).toBe("ApiResponseError");
  });

  it("is an instance of Error", () => {
    expect(new ApiResponseError(500, "oops")).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// listTransactions
// ---------------------------------------------------------------------------

describe("listTransactions", () => {
  it("returns the API response data", async () => {
    server.use(
      http.get("/api/transactions", () =>
        HttpResponse.json({
          items: [{ id: 1, description: "Coffee", amount: "-5.00" }],
          has_more: false,
          next_cursor: null,
          total_count: 1,
        })
      )
    );
    const result = await listTransactions();
    expect(result.total_count).toBe(1);
    expect(result.items[0].description).toBe("Coffee");
  });

  it("adds defined, non-empty filter values to the query string", async () => {
    let capturedUrl = "";
    server.use(
      http.get("/api/transactions", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ items: [], has_more: false, next_cursor: null, total_count: 0 });
      })
    );
    await listTransactions({ description: "coffee", merchant: "Starbucks", limit: 25 });
    const params = new URL(capturedUrl).searchParams;
    expect(params.get("description")).toBe("coffee");
    expect(params.get("merchant")).toBe("Starbucks");
    expect(params.get("limit")).toBe("25");
  });

  it("omits undefined and empty-string filter values", async () => {
    let capturedUrl = "";
    server.use(
      http.get("/api/transactions", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ items: [], has_more: false, next_cursor: null, total_count: 0 });
      })
    );
    await listTransactions({ description: undefined, merchant: "" });
    const params = new URL(capturedUrl).searchParams;
    expect(params.has("description")).toBe(false);
    expect(params.has("merchant")).toBe(false);
  });

  it("throws ApiResponseError with status and detail on non-ok response", async () => {
    server.use(
      http.get("/api/transactions", () =>
        HttpResponse.json({ detail: "Unauthorized" }, { status: 401 })
      )
    );
    await expect(listTransactions()).rejects.toMatchObject({
      status: 401,
      detail: "Unauthorized",
      name: "ApiResponseError",
    });
  });

  it("falls back to statusText when response body has no detail field", async () => {
    server.use(
      http.get(
        "/api/transactions",
        () => new HttpResponse(null, { status: 503, statusText: "Service Unavailable" })
      )
    );
    await expect(listTransactions()).rejects.toMatchObject({ status: 503 });
  });
});

// ---------------------------------------------------------------------------
// listMerchants
// ---------------------------------------------------------------------------

describe("listMerchants", () => {
  it("serialises name, location, and limit filters as query params", async () => {
    let capturedUrl = "";
    server.use(
      http.get("/api/merchants", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ items: [], has_more: false, next_cursor: null });
      })
    );
    await listMerchants({ name: "star", location: "seattle", limit: 10 });
    const params = new URL(capturedUrl).searchParams;
    expect(params.get("name")).toBe("star");
    expect(params.get("location")).toBe("seattle");
    expect(params.get("limit")).toBe("10");
  });

  it("makes a plain request with no params when called without filters", async () => {
    let capturedUrl = "";
    server.use(
      http.get("/api/merchants", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ items: [], has_more: false, next_cursor: null });
      })
    );
    await listMerchants();
    expect(new URL(capturedUrl).search).toBe("");
  });
});

// ---------------------------------------------------------------------------
// updateTransaction
// ---------------------------------------------------------------------------

describe("updateTransaction", () => {
  it("sends PATCH with JSON body and returns the updated item", async () => {
    let capturedBody: unknown = null;
    const mockTx = { id: 42, description: "Coffee", amount: "-5.00", merchant: "Starbucks" };
    server.use(
      http.patch("/api/transactions/42", async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(mockTx);
      })
    );
    const body = {
      description: "Coffee",
      merchant_name: "Starbucks",
      category: null,
      subcategory: null,
      notes: null,
    };
    const result = await updateTransaction(42, body);
    expect(capturedBody).toEqual(body);
    expect(result).toMatchObject(mockTx);
  });
});

// ---------------------------------------------------------------------------
// parseQuery
// ---------------------------------------------------------------------------

describe("parseQuery", () => {
  it("sends POST with the query string and returns filters + explanation", async () => {
    let capturedBody: unknown = null;
    server.use(
      http.post("/api/ai/parse-query", async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          filters: { merchant: "Starbucks" },
          explanation: "Starbucks purchases",
        });
      })
    );
    const result = await parseQuery("show starbucks");
    expect(capturedBody).toEqual({ query: "show starbucks" });
    expect(result.explanation).toBe("Starbucks purchases");
    expect(result.filters.merchant).toBe("Starbucks");
  });
});
