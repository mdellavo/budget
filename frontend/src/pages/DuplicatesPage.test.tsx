import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { server } from "../mocks/server";
import DuplicatesPage from "./DuplicatesPage";

const TX_BASE = {
  id: 1,
  date: "2024-03-10",
  description: "Coffee A",
  amount: "-4.50",
  account_id: 1,
  account: "Checking",
  merchant: null,
  merchant_website: null,
  category: null,
  subcategory: null,
  notes: null,
  is_recurring: false,
  is_excluded: false,
  is_refund: false,
  is_international: false,
  payment_channel: null,
  raw_description: "COFFEE A",
  cardholder_name: null,
  card_number: null,
  tags: [],
};

const TX2 = { ...TX_BASE, id: 2, description: "Coffee B", raw_description: "COFFEE B" };

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderPage() {
  return render(
    <MemoryRouter>
      <DuplicatesPage />
    </MemoryRouter>
  );
}

describe("DuplicatesPage", () => {
  it("shows no duplicates message when groups is empty", async () => {
    renderPage();
    await screen.findByText("No duplicates found");
  });

  it("renders group cards with transaction rows", async () => {
    server.use(
      http.get("/api/transactions/duplicates", () =>
        HttpResponse.json({ groups: [[TX_BASE, TX2]] })
      )
    );
    renderPage();
    await screen.findByText("Coffee A");
    expect(screen.getByText("Coffee B")).toBeTruthy();
    // Should show 2 Exclude buttons
    const buttons = screen.getAllByRole("button", { name: /exclude/i });
    expect(buttons).toHaveLength(2);
  });

  it("removes row from group when Exclude is clicked", async () => {
    server.use(
      http.get("/api/transactions/duplicates", () =>
        HttpResponse.json({ groups: [[TX_BASE, TX2]] })
      ),
      http.patch("/api/transactions/1", () => HttpResponse.json({ ...TX_BASE, is_excluded: true }))
    );
    const user = userEvent.setup();
    renderPage();
    const buttons = await screen.findAllByRole("button", { name: /exclude/i });
    await user.click(buttons[0]);
    // After excluding tx1, only 1 remains in the group → card collapses
    await waitFor(() => {
      expect(screen.queryByText("Coffee A")).toBeNull();
    });
    // Group collapses so Coffee B is also gone
    expect(screen.queryByText("Coffee B")).toBeNull();
    // "No duplicates found" appears
    await screen.findByText("No duplicates found");
  });
});
