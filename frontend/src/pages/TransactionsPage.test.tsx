import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import TransactionsPage from "./TransactionsPage";

function renderPage(initialEntry = "/transactions") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <TransactionsPage />
    </MemoryRouter>
  );
}

const TX_1: Record<string, unknown> = {
  id: 1,
  date: "2026-02-10",
  description: "Coffee shop",
  amount: "-5.50",
  account_id: 1,
  account: "Chase Checking",
  merchant: "Starbucks",
  category: "Food",
  subcategory: "Restaurants",
  notes: null,
  is_recurring: false,
  raw_description: null,
  cardholder_name: null,
  card_number: null,
};

const TX_2: Record<string, unknown> = {
  id: 2,
  date: "2026-02-08",
  description: "Online purchase",
  amount: "-25.00",
  account_id: 1,
  account: "Chase Checking",
  merchant: "Amazon",
  category: "Shopping",
  subcategory: null,
  notes: null,
  is_recurring: false,
  raw_description: null,
  cardholder_name: null,
  card_number: null,
};

const TRANSACTIONS_RESPONSE = {
  items: [TX_1],
  has_more: false,
  next_cursor: null,
  total_count: 1,
};

describe("TransactionsPage", () => {
  it("shows loading indicator while fetching", () => {
    renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders transaction rows with date, merchant, description, amount, and category", async () => {
    server.use(http.get("/api/transactions", () => HttpResponse.json(TRANSACTIONS_RESPONSE)));
    renderPage();
    expect(await screen.findByText("2026-02-10")).toBeInTheDocument();
    expect(screen.getByText("Coffee shop")).toBeInTheDocument();
    expect(screen.getByText("Starbucks")).toBeInTheDocument();
    expect(screen.getByText("Food / Restaurants")).toBeInTheDocument();
    expect(screen.getByText("-$5.50")).toBeInTheDocument();
    expect(screen.getByText("Chase Checking")).toBeInTheDocument();
  });

  it("shows total count in heading area", async () => {
    server.use(
      http.get("/api/transactions", () =>
        HttpResponse.json({ ...TRANSACTIONS_RESPONSE, total_count: 42 })
      )
    );
    renderPage();
    await screen.findByText(/42 transactions/);
  });

  it("shows empty state when no transactions found", async () => {
    // Default handler returns empty
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    expect(screen.getByText("No transactions found.")).toBeInTheDocument();
  });

  it("shows error when API fails", async () => {
    server.use(
      http.get("/api/transactions", () =>
        HttpResponse.json({ detail: "DB error" }, { status: 500 })
      )
    );
    renderPage();
    await screen.findByText(/API 500/);
  });

  it("pre-populates merchant filter from URL search params", async () => {
    server.use(http.get("/api/transactions", () => HttpResponse.json(TRANSACTIONS_RESPONSE)));
    renderPage("/transactions?merchant=Starbucks");
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    const merchantInput = screen.getByPlaceholderText("e.g. Starbucks");
    expect(merchantInput).toHaveValue("Starbucks");
  });

  it("sends merchant filter to API when Apply is clicked", async () => {
    const user = userEvent.setup();
    let capturedUrl = "";
    server.use(
      http.get("/api/transactions", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(TRANSACTIONS_RESPONSE);
      })
    );
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    const merchantInput = screen.getByPlaceholderText("e.g. Starbucks");
    await user.type(merchantInput, "Amazon");
    capturedUrl = "";
    await user.click(screen.getByRole("button", { name: /apply/i }));
    await waitFor(() => {
      expect(capturedUrl).not.toBe("");
      expect(new URL(capturedUrl).searchParams.get("merchant")).toBe("Amazon");
    });
  });

  it("clears all filters when Clear is clicked", async () => {
    const user = userEvent.setup();
    renderPage("/transactions?merchant=Starbucks");
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    const merchantInput = screen.getByPlaceholderText("e.g. Starbucks");
    expect(merchantInput).toHaveValue("Starbucks");
    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(merchantInput).toHaveValue("");
  });

  it("shows BulkEditBar when a row checkbox is selected", async () => {
    const user = userEvent.setup();
    server.use(http.get("/api/transactions", () => HttpResponse.json(TRANSACTIONS_RESPONSE)));
    renderPage();
    await screen.findByText("Coffee shop");
    // Find all checkboxes; first is select-all, second is row checkbox
    const checkboxes = screen.getAllByRole("checkbox");
    const rowCheckbox = checkboxes[1];
    await user.click(rowCheckbox);
    // BulkEditBar should appear showing "1 selected"
    await screen.findByText("1 selected");
  });

  it("shows Load more button when hasMore is true and loads next page on click", async () => {
    const user = userEvent.setup();
    let callCount = 0;
    server.use(
      http.get("/api/transactions", () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json({
            items: [TX_1],
            has_more: true,
            next_cursor: 1,
            total_count: 2,
          });
        }
        return HttpResponse.json({
          items: [TX_2],
          has_more: false,
          next_cursor: null,
          total_count: 2,
        });
      })
    );
    renderPage();
    await screen.findByText("Coffee shop");
    await user.click(screen.getByRole("button", { name: /load more/i }));
    await screen.findByText("Online purchase");
    expect(screen.getByText("Coffee shop")).toBeInTheDocument();
  });

  it("opens transaction detail modal when a row is clicked", async () => {
    const user = userEvent.setup();
    server.use(http.get("/api/transactions", () => HttpResponse.json(TRANSACTIONS_RESPONSE)));
    renderPage();
    await screen.findByText("Coffee shop");
    // Click on the description text to open detail modal
    await user.click(screen.getByText("Coffee shop"));
    await screen.findByRole("dialog");
    expect(screen.getByText("Transaction Details")).toBeInTheDocument();
  });

  it("opens edit modal when the edit button (pencil icon) is clicked", async () => {
    const user = userEvent.setup();
    server.use(http.get("/api/transactions", () => HttpResponse.json(TRANSACTIONS_RESPONSE)));
    renderPage();
    await screen.findByText("Coffee shop");
    await user.click(screen.getByRole("button", { name: /edit transaction/i }));
    await screen.findByRole("dialog");
    expect(screen.getByText("Edit Transaction")).toBeInTheDocument();
  });

  it("submits NL query and applies returned filters", async () => {
    const user = userEvent.setup();
    let capturedTxUrl = "";
    server.use(
      http.get("/api/transactions", ({ request }) => {
        capturedTxUrl = request.url;
        return HttpResponse.json(TRANSACTIONS_RESPONSE);
      }),
      http.post("/api/ai/parse-query", () =>
        HttpResponse.json({
          filters: { merchant: "Starbucks" },
          explanation: "Starbucks purchases",
        })
      )
    );
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());

    const nlInput = screen.getByPlaceholderText(/Ask in plain English/);
    await user.type(nlInput, "starbucks");
    capturedTxUrl = "";
    await user.click(screen.getByRole("button", { name: /^ask$/i }));

    // Explanation badge should appear
    await screen.findByText("Starbucks purchases");

    // Merchant filter applied in API call
    await waitFor(() => {
      expect(capturedTxUrl).not.toBe("");
      expect(new URL(capturedTxUrl).searchParams.get("merchant")).toBe("Starbucks");
    });
  });

  it("marks recurring transactions with a 'recurring' badge", async () => {
    const recurringTx = { ...TX_1, is_recurring: true };
    server.use(
      http.get("/api/transactions", () =>
        HttpResponse.json({
          items: [recurringTx],
          has_more: false,
          next_cursor: null,
          total_count: 1,
        })
      )
    );
    renderPage();
    await screen.findByText("Coffee shop");
    expect(screen.getByText("recurring")).toBeInTheDocument();
  });

  it("shows Raw description in detail modal when raw_description differs from description", async () => {
    const user = userEvent.setup();
    const txWithRaw = {
      ...TX_1,
      description: "Starbucks Coffee",
      raw_description: "STARBUCKS #4821 SEATTLE WA",
    };
    server.use(
      http.get("/api/transactions", () =>
        HttpResponse.json({
          items: [txWithRaw],
          has_more: false,
          next_cursor: null,
          total_count: 1,
        })
      )
    );
    renderPage();
    await screen.findByText("Starbucks Coffee");
    await user.click(screen.getByText("Starbucks Coffee"));
    await screen.findByRole("dialog");
    expect(screen.getByText("Raw description")).toBeInTheDocument();
    expect(screen.getByText("STARBUCKS #4821 SEATTLE WA")).toBeInTheDocument();
  });

  it("hides Raw description in detail modal when raw_description is null", async () => {
    const user = userEvent.setup();
    // TX_1 has raw_description: null
    server.use(http.get("/api/transactions", () => HttpResponse.json(TRANSACTIONS_RESPONSE)));
    renderPage();
    await screen.findByText("Coffee shop");
    await user.click(screen.getByText("Coffee shop"));
    await screen.findByRole("dialog");
    expect(screen.queryByText("Raw description")).not.toBeInTheDocument();
  });

  it("hides Raw description in detail modal when raw_description matches description", async () => {
    const user = userEvent.setup();
    const txSame = { ...TX_1, raw_description: "Coffee shop" };
    server.use(
      http.get("/api/transactions", () =>
        HttpResponse.json({
          items: [txSame],
          has_more: false,
          next_cursor: null,
          total_count: 1,
        })
      )
    );
    renderPage();
    await screen.findByText("Coffee shop");
    await user.click(screen.getByText("Coffee shop"));
    await screen.findByRole("dialog");
    expect(screen.queryByText("Raw description")).not.toBeInTheDocument();
  });

  it("shows Re-enrich button in edit modal when tx has raw_description", async () => {
    const user = userEvent.setup();
    const txWithRaw = { ...TX_1, raw_description: "STARBUCKS #4821 SEATTLE WA" };
    server.use(
      http.get("/api/transactions", () =>
        HttpResponse.json({
          items: [txWithRaw],
          has_more: false,
          next_cursor: null,
          total_count: 1,
        })
      )
    );
    renderPage();
    await screen.findByText("Coffee shop");
    await user.click(screen.getByRole("button", { name: /edit transaction/i }));
    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: /^re-enrich$/i })).toBeInTheDocument();
  });

  it("hides Re-enrich button in edit modal when raw_description is null", async () => {
    const user = userEvent.setup();
    // TX_1 has raw_description: null
    server.use(http.get("/api/transactions", () => HttpResponse.json(TRANSACTIONS_RESPONSE)));
    renderPage();
    await screen.findByText("Coffee shop");
    await user.click(screen.getByRole("button", { name: /edit transaction/i }));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: /^re-enrich$/i })).not.toBeInTheDocument();
  });

  it("Re-enrich in edit modal calls API, updates the row, and closes the modal", async () => {
    const user = userEvent.setup();
    const txWithRaw = {
      ...TX_1,
      description: "STARBUCKS #4821",
      raw_description: "STARBUCKS #4821 SEATTLE WA",
    };
    const enrichedTx = {
      ...txWithRaw,
      description: "Starbucks Coffee",
      merchant: "Starbucks",
      category: "Food & Drink",
      subcategory: "Coffee & Tea",
    };
    server.use(
      http.get("/api/transactions", () =>
        HttpResponse.json({
          items: [txWithRaw],
          has_more: false,
          next_cursor: null,
          total_count: 1,
        })
      ),
      http.post("/api/transactions/re-enrich", () => HttpResponse.json({ items: [enrichedTx] }))
    );
    renderPage();
    await screen.findByText("STARBUCKS #4821");
    await user.click(screen.getByRole("button", { name: /edit transaction/i }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: /^re-enrich$/i }));
    // Modal closes and the row in the list is updated
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Starbucks Coffee")).toBeInTheDocument();
  });

  it("shows Re-enrich count in BulkEditBar when eligible transactions are selected", async () => {
    const user = userEvent.setup();
    const txWithRaw = { ...TX_1, raw_description: "STARBUCKS #4821 SEATTLE WA" };
    server.use(
      http.get("/api/transactions", () =>
        HttpResponse.json({
          items: [txWithRaw],
          has_more: false,
          next_cursor: null,
          total_count: 1,
        })
      )
    );
    renderPage();
    await screen.findByText("Coffee shop");
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[1]); // row checkbox
    await screen.findByText("1 selected");
    expect(screen.getByRole("button", { name: /re-enrich \(1 eligible\)/i })).toBeInTheDocument();
  });

  it("bulk Re-enrich calls API, updates rows in place, and clears selection", async () => {
    const user = userEvent.setup();
    const txWithRaw = { ...TX_1, raw_description: "STARBUCKS #4821 SEATTLE WA" };
    const enrichedTx = { ...txWithRaw, description: "Starbucks Coffee", merchant: "Starbucks" };
    server.use(
      http.get("/api/transactions", () =>
        HttpResponse.json({
          items: [txWithRaw],
          has_more: false,
          next_cursor: null,
          total_count: 1,
        })
      ),
      http.post("/api/transactions/re-enrich", () => HttpResponse.json({ items: [enrichedTx] }))
    );
    renderPage();
    await screen.findByText("Coffee shop");
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[1]);
    await screen.findByText("1 selected");
    await user.click(screen.getByRole("button", { name: /re-enrich \(1 eligible\)/i }));
    await screen.findByText("Starbucks Coffee");
    await waitFor(() => {
      expect(screen.queryByText("1 selected")).not.toBeInTheDocument();
    });
  });

  it("renders cardholder filter input in filter bar", async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    // Card Holder filter is the only "e.g. 1234" placeholder when no modal is open
    expect(screen.getByPlaceholderText("e.g. 1234")).toBeInTheDocument();
  });

  it("sends cardholder filter to API when applied", async () => {
    const user = userEvent.setup();
    let capturedUrl = "";
    server.use(
      http.get("/api/transactions", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(TRANSACTIONS_RESPONSE);
      })
    );
    renderPage();
    await screen.findByText("Coffee shop");
    const input = screen.getByPlaceholderText("e.g. 1234");
    await user.type(input, "1234");
    capturedUrl = "";
    await user.click(screen.getByRole("button", { name: /apply/i }));
    await waitFor(() => {
      expect(capturedUrl).not.toBe("");
      expect(new URL(capturedUrl).searchParams.get("cardholder")).toBe("1234");
    });
  });

  it("shows card number and cardholder name in detail modal", async () => {
    const user = userEvent.setup();
    const txWithCard = { ...TX_1, card_number: "9999", cardholder_name: "Alice" };
    server.use(
      http.get("/api/transactions", () =>
        HttpResponse.json({
          items: [txWithCard],
          has_more: false,
          next_cursor: null,
          total_count: 1,
        })
      )
    );
    renderPage();
    // Click the row to open detail modal
    await user.click(await screen.findByText("Coffee shop"));
    await screen.findByRole("dialog");
    expect(screen.getByText("9999")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("shows card_number field in edit modal pre-populated", async () => {
    const user = userEvent.setup();
    const txWithCard = { ...TX_1, card_number: "9999", cardholder_name: "Alice" };
    server.use(
      http.get("/api/transactions", () =>
        HttpResponse.json({
          items: [txWithCard],
          has_more: false,
          next_cursor: null,
          total_count: 1,
        })
      )
    );
    renderPage();
    await screen.findByText("Coffee shop");
    await user.click(screen.getByRole("button", { name: /edit transaction/i }));
    await screen.findByRole("dialog");
    // The edit modal pre-fills card_number with the current value "9999"
    expect(screen.getByDisplayValue("9999")).toBeInTheDocument();
  });
});
