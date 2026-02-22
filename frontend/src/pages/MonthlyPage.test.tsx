import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import MonthlyPage from "./MonthlyPage";

// Plotly is a CDN global; mock to prevent errors in useEffect.
beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).Plotly = { react: vi.fn() };
});

function renderPage(initialEntry = "/monthly") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <MonthlyPage />
    </MemoryRouter>
  );
}

const MONTHS_RESPONSE = { months: ["2026-02", "2026-01", "2025-12"] };

const MONTHLY_REPORT = {
  month: "2026-02",
  summary: {
    transaction_count: 42,
    income: "3000.00",
    expenses: "-2100.00",
    net: "900.00",
    savings_rate: 30.0,
  },
  category_breakdown: [
    {
      category: "Food",
      total: "-800.00",
      subcategories: [{ subcategory: "Groceries", total: "-600.00" }],
    },
  ],
};

describe("MonthlyPage", () => {
  it("shows loading while fetching months", () => {
    renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders months grouped by year in sidebar", async () => {
    server.use(http.get("/api/monthly", () => HttpResponse.json(MONTHS_RESPONSE)));
    renderPage();
    // Should show year headers
    await screen.findByText("2026");
    expect(screen.getByText("2025")).toBeInTheDocument();
    // Should show month names
    expect(screen.getByRole("button", { name: "February" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "January" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "December" })).toBeInTheDocument();
  });

  it("renders the monthly report when a month is selected", async () => {
    server.use(
      http.get("/api/monthly", () => HttpResponse.json(MONTHS_RESPONSE)),
      http.get("/api/monthly/:month", () => HttpResponse.json(MONTHLY_REPORT))
    );
    renderPage("/monthly?month=2026-02");
    // Report title
    await screen.findByText("February 2026");
    // Summary cards
    expect(screen.getByText(/\$3,000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$2,100\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$900\.00/)).toBeInTheDocument();
    expect(screen.getByText("30.0%")).toBeInTheDocument();
    // Category breakdown
    expect(screen.getByText("Food")).toBeInTheDocument();
    expect(screen.getByText("Groceries")).toBeInTheDocument();
  });

  it("clicking a month button fetches and shows its report", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/api/monthly", () => HttpResponse.json(MONTHS_RESPONSE)),
      http.get("/api/monthly/:month", () => HttpResponse.json(MONTHLY_REPORT))
    );
    renderPage();
    await screen.findByText("February");
    await user.click(screen.getByRole("button", { name: "February" }));
    await screen.findByText("February 2026");
  });

  it("shows 'No data yet.' when months list is empty", async () => {
    server.use(http.get("/api/monthly", () => HttpResponse.json({ months: [] })));
    renderPage();
    await screen.findByText("No data yet.");
  });

  it("shows error when months API fails", async () => {
    server.use(
      http.get("/api/monthly", () => HttpResponse.json({ detail: "DB error" }, { status: 500 }))
    );
    renderPage();
    await screen.findByText(/API 500/);
  });

  it("'View all transactions' link navigates to /transactions with date range", async () => {
    server.use(
      http.get("/api/monthly", () => HttpResponse.json(MONTHS_RESPONSE)),
      http.get("/api/monthly/:month", () => HttpResponse.json(MONTHLY_REPORT))
    );
    renderPage("/monthly?month=2026-02");
    await screen.findByText("February 2026");
    const viewAllLink = screen.getByRole("link", { name: /View all transactions/i });
    expect(viewAllLink.getAttribute("href")).toContain("date_from=2026-02-01");
    expect(viewAllLink.getAttribute("href")).toContain("date_to=2026-02-28");
  });

  it("category links in breakdown navigate to /transactions filtered by category", async () => {
    server.use(
      http.get("/api/monthly", () => HttpResponse.json(MONTHS_RESPONSE)),
      http.get("/api/monthly/:month", () => HttpResponse.json(MONTHLY_REPORT))
    );
    renderPage("/monthly?month=2026-02");
    await screen.findByText("Food");
    const foodLink = screen.getAllByRole("link").find((l) => l.textContent === "Food");
    expect(foodLink).toBeDefined();
    expect(foodLink!.getAttribute("href")).toContain("category=Food");
  });

  it("shows savings rate as '—' when null", async () => {
    const reportNoSavings = {
      ...MONTHLY_REPORT,
      summary: { ...MONTHLY_REPORT.summary, savings_rate: null },
    };
    server.use(
      http.get("/api/monthly", () => HttpResponse.json(MONTHS_RESPONSE)),
      http.get("/api/monthly/:month", () => HttpResponse.json(reportNoSavings))
    );
    renderPage("/monthly?month=2026-02");
    await screen.findByText("February 2026");
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows 'No categorized spending this month.' for empty breakdown", async () => {
    const emptyBreakdown = {
      ...MONTHLY_REPORT,
      category_breakdown: [],
    };
    server.use(
      http.get("/api/monthly", () => HttpResponse.json(MONTHS_RESPONSE)),
      http.get("/api/monthly/:month", () => HttpResponse.json(emptyBreakdown))
    );
    renderPage("/monthly?month=2026-02");
    await screen.findByText(/No categorized spending this month/i);
  });
});
