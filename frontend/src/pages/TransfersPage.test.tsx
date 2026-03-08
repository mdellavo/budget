import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import TransfersPage from "./TransfersPage";
import type { TransactionItem } from "../types";

function makeTransfer(overrides: Partial<TransactionItem> = {}): TransactionItem {
  return {
    id: 1,
    date: "2024-03-01",
    description: "Transfer",
    amount: "-500.00",
    account_id: 1,
    account: "Checking",
    merchant: null,
    merchant_website: null,
    category: "Transfer",
    subcategory: "Transfer",
    notes: null,
    is_recurring: false,
    is_excluded: false,
    is_refund: false,
    is_international: false,
    payment_channel: "transfer",
    raw_description: null,
    cardholder_name: null,
    card_number: null,
    tags: [],
    linked_transaction_id: null,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <TransfersPage />
    </MemoryRouter>
  );
}

describe("TransfersPage", () => {
  beforeEach(() => {
    (globalThis as unknown as Record<string, unknown>).Plotly = { react: vi.fn() };
  });

  it("shows loading initially", () => {
    server.use(http.get("/api/transactions", () => new Promise(() => {})));
    renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders matched pairs section with account, date, and amount", async () => {
    const debit = makeTransfer({
      id: 1,
      amount: "-500.00",
      account: "Checking",
      date: "2024-03-01",
      linked_transaction_id: 2,
    });
    const credit = makeTransfer({
      id: 2,
      amount: "500.00",
      account: "Savings",
      date: "2024-03-02",
      linked_transaction_id: 1,
    });
    server.use(
      http.get("/api/transactions", () =>
        HttpResponse.json({
          items: [debit, credit],
          has_more: false,
          next_cursor: null,
          total_count: 2,
          total_amount: "0",
        })
      )
    );
    renderPage();
    await screen.findByText("Matched Pairs");
    expect(screen.getByText("Checking")).toBeInTheDocument();
    expect(screen.getByText("Savings")).toBeInTheDocument();
    expect(screen.getByText("2024-03-01")).toBeInTheDocument();
    expect(screen.getByText("2024-03-02")).toBeInTheDocument();
  });

  it("renders unmatched transfers with warning indicator", async () => {
    const unmatched = makeTransfer({ id: 3, linked_transaction_id: null });
    server.use(
      http.get("/api/transactions", () =>
        HttpResponse.json({
          items: [unmatched],
          has_more: false,
          next_cursor: null,
          total_count: 1,
          total_amount: "-500",
        })
      )
    );
    renderPage();
    await screen.findByText("Unmatched Transfers");
    expect(screen.getByTitle("Unmatched transfer")).toBeInTheDocument();
  });

  it("shows zero counts when no transfers", async () => {
    server.use(
      http.get("/api/transactions", () =>
        HttpResponse.json({
          items: [],
          has_more: false,
          next_cursor: null,
          total_count: 0,
          total_amount: "0",
        })
      )
    );
    renderPage();
    await screen.findByText("No matched pairs.");
    expect(screen.getByText("All transfers are matched.")).toBeInTheDocument();
  });

  it("unlink button calls PATCH with clear_linked_transaction", async () => {
    const user = userEvent.setup();
    const debit = makeTransfer({
      id: 1,
      amount: "-500.00",
      account: "Checking",
      linked_transaction_id: 2,
    });
    const credit = makeTransfer({
      id: 2,
      amount: "500.00",
      account: "Savings",
      linked_transaction_id: 1,
    });

    const patchSpy = vi.fn();
    server.use(
      http.get("/api/transactions", () =>
        HttpResponse.json({
          items: [debit, credit],
          has_more: false,
          next_cursor: null,
          total_count: 2,
          total_amount: "0",
        })
      ),
      http.patch("/api/transactions/:id", async ({ request }) => {
        const body = await request.json();
        patchSpy(body);
        return HttpResponse.json({ ...debit, linked_transaction_id: null });
      })
    );

    renderPage();
    const unlinkBtn = await screen.findByRole("button", { name: "Unlink" });
    await user.click(unlinkBtn);

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ clear_linked_transaction: true })
      );
    });
  });

  it("renders the transfer flows chart when matched pairs exist", async () => {
    const debit = makeTransfer({
      id: 1,
      amount: "-500.00",
      account: "Checking",
      linked_transaction_id: 2,
    });
    const credit = makeTransfer({
      id: 2,
      amount: "500.00",
      account: "Savings",
      linked_transaction_id: 1,
    });
    server.use(
      http.get("/api/transactions", () =>
        HttpResponse.json({
          items: [debit, credit],
          has_more: false,
          next_cursor: null,
          total_count: 2,
          total_amount: "0",
        })
      )
    );
    renderPage();
    await screen.findByText("Transfer Flows");
    const plotly = (globalThis as Record<string, unknown>).Plotly as {
      react: ReturnType<typeof vi.fn>;
    };
    await waitFor(() => expect(plotly.react).toHaveBeenCalled());
  });

  it("does not render the chart when there are no matched pairs", async () => {
    server.use(
      http.get("/api/transactions", () =>
        HttpResponse.json({
          items: [],
          has_more: false,
          next_cursor: null,
          total_count: 0,
          total_amount: "0",
        })
      )
    );
    renderPage();
    await screen.findByText("No matched pairs.");
    expect(screen.queryByText("Transfer Flows")).not.toBeInTheDocument();
  });

  it("shows All time preset as active by default", async () => {
    server.use(
      http.get("/api/transactions", () =>
        HttpResponse.json({
          items: [],
          has_more: false,
          next_cursor: null,
          total_count: 0,
          total_amount: "0",
        })
      )
    );
    renderPage();
    await screen.findByText("No matched pairs.");
    expect(screen.getByRole("button", { name: "All time" })).toHaveClass("bg-indigo-600");
  });

  it("clicking Last 30d passes date_from to the API", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    server.use(
      http.get("/api/transactions", ({ request }) => {
        spy(new URL(request.url).searchParams.get("date_from"));
        return HttpResponse.json({
          items: [],
          has_more: false,
          next_cursor: null,
          total_count: 0,
          total_amount: "0",
        });
      })
    );
    renderPage();
    await screen.findByText("No matched pairs.");
    await user.click(screen.getByRole("button", { name: "Last 30d" }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
    );
  });

  it("re-match button calls POST /transfers/rematch and shows result", async () => {
    const user = userEvent.setup();
    const rematchSpy = vi.fn();
    server.use(
      http.get("/api/transactions", () =>
        HttpResponse.json({
          items: [],
          has_more: false,
          next_cursor: null,
          total_count: 0,
          total_amount: "0",
        })
      ),
      http.post("/api/transfers/rematch", () => {
        rematchSpy();
        return HttpResponse.json({ pairs_linked: 3 });
      })
    );

    renderPage();
    await screen.findByRole("button", { name: "Re-match" });
    await user.click(screen.getByRole("button", { name: "Re-match" }));

    await waitFor(() => {
      expect(rematchSpy).toHaveBeenCalled();
    });
    await screen.findByText("Linked 3 new pairs.");
  });
});
