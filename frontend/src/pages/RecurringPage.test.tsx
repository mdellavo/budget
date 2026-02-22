import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import RecurringPage from "./RecurringPage";

function renderPage() {
  return render(
    <MemoryRouter>
      <RecurringPage />
    </MemoryRouter>
  );
}

const RECURRING_ITEM = {
  merchant: "Netflix",
  merchant_id: 1,
  category: "Entertainment",
  amount: "-15.99",
  frequency: "monthly",
  occurrences: 12,
  last_charge: "2026-01-15",
  next_estimated: "2026-03-15",
  monthly_cost: "-15.99",
};

describe("RecurringPage", () => {
  it("shows loading indicator while fetching", () => {
    renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders recurring transaction rows with merchant, category, and frequency", async () => {
    server.use(http.get("/api/recurring", () => HttpResponse.json({ items: [RECURRING_ITEM] })));
    renderPage();
    expect(await screen.findByText("Netflix")).toBeInTheDocument();
    expect(screen.getByText("Entertainment")).toBeInTheDocument();
    expect(screen.getByText("Monthly")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("shows the overdue date in red when next_estimated is in the past", async () => {
    const overdueItem = {
      ...RECURRING_ITEM,
      merchant: "OverdueService",
      next_estimated: "2025-01-01",
    };
    server.use(http.get("/api/recurring", () => HttpResponse.json({ items: [overdueItem] })));
    const { container } = renderPage();
    await screen.findByText("OverdueService");
    // The Est. Next cell gets text-red-600 font-bold when overdue
    const redBold = container.querySelector(".text-red-600.font-bold");
    expect(redBold).not.toBeNull();
  });

  it("shows empty state when no recurring transactions", async () => {
    // Default handler returns { items: [] }
    renderPage();
    expect(await screen.findByText("No recurring charges detected.")).toBeInTheDocument();
  });

  it("shows error state when API fails", async () => {
    server.use(
      http.get("/api/recurring", () =>
        HttpResponse.json({ detail: "Internal error" }, { status: 500 })
      )
    );
    renderPage();
    await screen.findByText(/API 500/);
  });

  it("merchant links navigate to /transactions?merchant=<name>", async () => {
    server.use(http.get("/api/recurring", () => HttpResponse.json({ items: [RECURRING_ITEM] })));
    renderPage();
    const link = await screen.findByRole("link", { name: "Netflix" });
    expect(link).toHaveAttribute("href", "/transactions?merchant=Netflix");
  });
});
