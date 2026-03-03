import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import YearlyPage from "./YearlyPage";

// Plotly is a CDN global; mock to prevent errors in useEffect.
beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).Plotly = { react: vi.fn() };
});

function renderPage(initialEntry = "/yearly") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <YearlyPage />
    </MemoryRouter>
  );
}

const YEARS_RESPONSE = { years: ["2025", "2024", "2023"] };

const YEARLY_REPORT = {
  year: "2024",
  summary: {
    transaction_count: 150,
    income: "60000.00",
    expenses: "-42000.00",
    net: "18000.00",
    savings_rate: 30.0,
    income_pct_change: 20.0,
    expenses_pct_change: -15.5,
    net_pct_change: 37.1,
  },
  category_breakdown: [
    {
      category: "Food & Drink",
      total: "-12000.00",
      pct_change: 25.0,
      subcategories: [{ subcategory: "Restaurants", total: "-8000.00", pct_change: 33.3 }],
    },
  ],
};

describe("YearlyPage", () => {
  it("shows loading while fetching years", () => {
    server.use(http.get("/api/yearly", () => new Promise(() => {})));
    renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders year list in sidebar", async () => {
    server.use(http.get("/api/yearly", () => HttpResponse.json(YEARS_RESPONSE)));
    renderPage();
    await screen.findByRole("button", { name: "2025" });
    expect(screen.getByRole("button", { name: "2024" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2023" })).toBeInTheDocument();
  });

  it("shows 'No data yet.' when years list is empty", async () => {
    server.use(http.get("/api/yearly", () => HttpResponse.json({ years: [] })));
    renderPage();
    await screen.findByText("No data yet.");
  });

  it("renders the yearly report when a year is selected via URL", async () => {
    server.use(
      http.get("/api/yearly", () => HttpResponse.json(YEARS_RESPONSE)),
      http.get("/api/yearly/:year", () => HttpResponse.json(YEARLY_REPORT))
    );
    renderPage("/yearly?year=2024");
    await screen.findByText("Annual report");
    expect(screen.getByText(/\$60,000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$42,000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$18,000\.00/)).toBeInTheDocument();
    expect(screen.getByText("30.0%")).toBeInTheDocument();
    expect(screen.getByText("Food & Drink")).toBeInTheDocument();
    expect(screen.getByText("Restaurants")).toBeInTheDocument();
  });

  it("clicking a year button fetches and shows its report", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/api/yearly", () => HttpResponse.json(YEARS_RESPONSE)),
      http.get("/api/yearly/:year", () => HttpResponse.json(YEARLY_REPORT))
    );
    renderPage();
    await screen.findByRole("button", { name: "2024" });
    await user.click(screen.getByRole("button", { name: "2024" }));
    await screen.findByText("Annual report");
    expect(screen.getByText("150 transactions")).toBeInTheDocument();
  });

  it("shows savings rate as '—' when null", async () => {
    const reportNoSavings = {
      ...YEARLY_REPORT,
      summary: { ...YEARLY_REPORT.summary, savings_rate: null },
    };
    server.use(
      http.get("/api/yearly", () => HttpResponse.json(YEARS_RESPONSE)),
      http.get("/api/yearly/:year", () => HttpResponse.json(reportNoSavings))
    );
    renderPage("/yearly?year=2024");
    await screen.findByText("Annual report");
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows 'No categorized spending this year.' for empty breakdown", async () => {
    const emptyBreakdown = { ...YEARLY_REPORT, category_breakdown: [] };
    server.use(
      http.get("/api/yearly", () => HttpResponse.json(YEARS_RESPONSE)),
      http.get("/api/yearly/:year", () => HttpResponse.json(emptyBreakdown))
    );
    renderPage("/yearly?year=2024");
    await screen.findByText(/No categorized spending this year/i);
  });

  it("shows prompt when no year is selected and list is loaded", async () => {
    server.use(http.get("/api/yearly", () => HttpResponse.json({ years: [] })));
    renderPage("/yearly");
    await screen.findByText("No data yet.");
  });

  it("'View all transactions' link contains correct date range for selected year", async () => {
    server.use(
      http.get("/api/yearly", () => HttpResponse.json(YEARS_RESPONSE)),
      http.get("/api/yearly/:year", () => HttpResponse.json(YEARLY_REPORT))
    );
    renderPage("/yearly?year=2024");
    await screen.findByText("Annual report");
    const link = screen.getByRole("link", { name: /View all transactions/i });
    expect(link.getAttribute("href")).toContain("date_from=2024-01-01");
    expect(link.getAttribute("href")).toContain("date_to=2024-12-31");
  });

  it("category links in breakdown navigate to /transactions filtered by category", async () => {
    server.use(
      http.get("/api/yearly", () => HttpResponse.json(YEARS_RESPONSE)),
      http.get("/api/yearly/:year", () => HttpResponse.json(YEARLY_REPORT))
    );
    renderPage("/yearly?year=2024");
    await screen.findByText("Food & Drink");
    const foodLinks = screen.getAllByRole("link").filter((l) => l.textContent === "Food & Drink");
    expect(foodLinks.length).toBeGreaterThan(0);
    expect(foodLinks[0].getAttribute("href")).toContain("category=Food+%26+Drink");
  });

  it("shows error when API fails", async () => {
    server.use(
      http.get("/api/yearly", () => HttpResponse.json({ detail: "Server error" }, { status: 500 }))
    );
    renderPage();
    await screen.findByText(/API 500/);
  });

  it("shows pct change chips when pct change values are non-null", async () => {
    server.use(
      http.get("/api/yearly", () => HttpResponse.json(YEARS_RESPONSE)),
      http.get("/api/yearly/:year", () => HttpResponse.json(YEARLY_REPORT))
    );
    renderPage("/yearly?year=2024");
    await screen.findByText("Annual report");
    expect(screen.getByText("+20.0%")).toBeInTheDocument();
    expect(screen.getByText("-15.5%")).toBeInTheDocument();
    expect(screen.getByText("+37.1%")).toBeInTheDocument();
  });

  it("shows no pct change chips when all pct change values are null", async () => {
    const reportNoPct = {
      ...YEARLY_REPORT,
      summary: {
        ...YEARLY_REPORT.summary,
        income_pct_change: null,
        expenses_pct_change: null,
        net_pct_change: null,
      },
      category_breakdown: [
        {
          category: "Food & Drink",
          total: "-12000.00",
          pct_change: null,
          subcategories: [{ subcategory: "Restaurants", total: "-8000.00", pct_change: null }],
        },
      ],
    };
    server.use(
      http.get("/api/yearly", () => HttpResponse.json(YEARS_RESPONSE)),
      http.get("/api/yearly/:year", () => HttpResponse.json(reportNoPct))
    );
    renderPage("/yearly?year=2024");
    await screen.findByText("Annual report");
    expect(screen.queryByText(/[+-]\d+\.\d+%/)).toBeNull();
  });

  it("shows pct change chips next to category and subcategory amounts", async () => {
    server.use(
      http.get("/api/yearly", () => HttpResponse.json(YEARS_RESPONSE)),
      http.get("/api/yearly/:year", () => HttpResponse.json(YEARLY_REPORT))
    );
    renderPage("/yearly?year=2024");
    await screen.findByText("Food & Drink");
    // Category pct_change: +25.0%
    expect(screen.getByText("+25.0%")).toBeInTheDocument();
    // Subcategory pct_change: +33.3%
    expect(screen.getByText("+33.3%")).toBeInTheDocument();
  });

  it("shows AI summary card when summary API returns data", async () => {
    server.use(
      http.get("/api/yearly", () => HttpResponse.json(YEARS_RESPONSE)),
      http.get("/api/yearly/:year", () => HttpResponse.json(YEARLY_REPORT)),
      http.get("/api/yearly/:year/summary", () =>
        HttpResponse.json({
          narrative: "You saved **$18,000** this year.",
          insights: ["Income grew 20% year-over-year.", "Food & Drink remained top expense."],
          recommendations: ["Increase emergency fund contributions."],
        })
      )
    );
    renderPage("/yearly?year=2024");
    await screen.findByText("AI Summary");
    expect(screen.getByText("Key Insights")).toBeInTheDocument();
    expect(document.body.textContent).toContain("Income grew 20% year-over-year.");
    expect(document.body.textContent).toContain("Increase emergency fund contributions.");
  });
});
