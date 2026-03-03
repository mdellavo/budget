import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import BudgetPage from "./BudgetPage";

// Plotly is a CDN global; mock to prevent errors in useEffect.
beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).Plotly = { react: vi.fn() };
});

function renderPage(initialEntry = "/budgets") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <BudgetPage />
    </MemoryRouter>
  );
}

const BUDGET_FOOD: object = {
  id: 1,
  name: "Food & Drink",
  scope: "category",
  category_id: 10,
  subcategory_id: null,
  amount_limit: "300.00",
  spent: "120.00",
  forecast: "180.00",
  pct: 40,
  forecast_pct: 60,
  severity: null,
};

const BUDGET_OVER: object = {
  id: 2,
  name: "Entertainment",
  scope: "category",
  category_id: 11,
  subcategory_id: null,
  amount_limit: "50.00",
  spent: "75.00",
  forecast: "75.00",
  pct: 150,
  forecast_pct: 150,
  severity: "over",
};

const BUDGET_APPROACHING: object = {
  id: 3,
  name: "Transport",
  scope: "category",
  category_id: 12,
  subcategory_id: null,
  amount_limit: "200.00",
  spent: "185.00",
  forecast: "190.00",
  pct: 92,
  forecast_pct: 95,
  severity: "approaching",
};

describe("BudgetPage", () => {
  it("shows loading state initially", () => {
    server.use(http.get("/api/budgets", () => new Promise(() => {})));
    renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows 'No budgets yet.' when list is empty", async () => {
    renderPage(); // default handler returns empty list
    await screen.findByText(/No budgets yet/i);
  });

  it("renders budget names and amounts from API", async () => {
    server.use(
      http.get("/api/budgets", () => HttpResponse.json({ items: [BUDGET_FOOD], month: "2026-03" }))
    );
    renderPage();
    await screen.findByText("Food & Drink");
    expect(screen.getByText(/\$300\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$120\.00/)).toBeInTheDocument();
  });

  it("shows 'Over budget' badge for severity=over", async () => {
    server.use(
      http.get("/api/budgets", () => HttpResponse.json({ items: [BUDGET_OVER], month: "2026-03" }))
    );
    renderPage();
    await screen.findByText("Over budget");
  });

  it("shows 'Approaching' badge for severity=approaching", async () => {
    server.use(
      http.get("/api/budgets", () =>
        HttpResponse.json({ items: [BUDGET_APPROACHING], month: "2026-03" })
      )
    );
    renderPage();
    await screen.findByText("Approaching");
  });

  it("shows '+ Add Budget' button and opens form on click", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/No budgets yet/i);
    const addBtn = screen.getByRole("button", { name: /\+ Add Budget/i });
    await user.click(addBtn);
    expect(screen.getByText("New Budget")).toBeInTheDocument();
  });

  it("shows 'Generate Budgets' button and closes on cancel", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/No budgets yet/i);
    await user.click(screen.getByRole("button", { name: /Generate Budgets/i }));
    // Wizard section should appear — it loads /api/budgets/wizard
    await screen.findByText(/50\/30\/20/i);
  });

  it("delete button calls delete API and reloads", async () => {
    (globalThis as unknown as Record<string, unknown>).confirm = vi.fn().mockReturnValue(true);
    let deleteCallCount = 0;
    server.use(
      http.get("/api/budgets", () => HttpResponse.json({ items: [BUDGET_FOOD], month: "2026-03" })),
      http.delete("/api/budgets/:id", () => {
        deleteCallCount++;
        return new HttpResponse(null, { status: 204 });
      })
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Food & Drink");
    const deleteBtn = screen.getByRole("button", { name: /delete/i });
    await user.click(deleteBtn);
    await waitFor(() => expect(deleteCallCount).toBe(1));
    vi.restoreAllMocks();
  });

  it("shows error when budgets API fails", async () => {
    server.use(
      http.get("/api/budgets", () => HttpResponse.json({ detail: "DB error" }, { status: 500 }))
    );
    renderPage();
    await screen.findByText(/API 500/i);
  });

  it("'Budgets' heading is rendered", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Budgets" });
  });

  it("renders multiple budgets", async () => {
    server.use(
      http.get("/api/budgets", () =>
        HttpResponse.json({
          items: [BUDGET_FOOD, BUDGET_OVER, BUDGET_APPROACHING],
          month: "2026-03",
        })
      )
    );
    renderPage();
    await screen.findByText("Food & Drink");
    expect(screen.getByText("Entertainment")).toBeInTheDocument();
    expect(screen.getByText("Transport")).toBeInTheDocument();
  });

  it("shows AI summary card when summary API returns data", async () => {
    server.use(
      http.get("/api/budgets", () => HttpResponse.json({ items: [BUDGET_FOOD], month: "2026-03" })),
      http.get("/api/budgets/:month/summary", () =>
        HttpResponse.json({
          narrative: "Good month overall.",
          insights: ["Food spending is on track."],
          recommendations: ["Keep it up!"],
        })
      )
    );
    renderPage();
    await screen.findByText("AI Summary");
    expect(screen.getByText("Good month overall.")).toBeInTheDocument();
  });

  it("does not show AI summary card when no budgets exist", async () => {
    server.use(
      http.get("/api/budgets/:month/summary", () =>
        HttpResponse.json({
          narrative: "Good month overall.",
          insights: ["No budgets set."],
          recommendations: ["Add a budget."],
        })
      )
    );
    renderPage(); // default /api/budgets returns empty list
    await screen.findByText(/No budgets yet/i);
    expect(screen.queryByText("AI Summary")).not.toBeInTheDocument();
  });
});
