import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import OverviewPage from "./OverviewPage";

// Plotly is loaded via CDN as a global; mock it so useEffect calls don't throw.
beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).Plotly = { react: vi.fn() };
});

const OVERVIEW_DATA = {
  transaction_count: 150,
  income: "5000.00",
  expenses: "-3200.00",
  net: "1800.00",
  savings_rate: 36.0,
  expense_breakdown: [],
  sankey: { income_sources: [], expense_categories: [] },
  budget_warnings: [],
};

describe("OverviewPage", () => {
  it("shows loading indicator while fetching", () => {
    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("hides loading and renders stat cards after successful fetch", async () => {
    server.use(http.get("/api/overview", () => HttpResponse.json(OVERVIEW_DATA)));
    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    // Transaction count
    expect(screen.getByText("150")).toBeInTheDocument();
    // Savings rate
    expect(screen.getByText("36.0%")).toBeInTheDocument();
    // Currency values
    expect(screen.getByText(/\$5,000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$3,200\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$1,800\.00/)).toBeInTheDocument();
  });

  it("renders all 5 stat card labels", async () => {
    server.use(http.get("/api/overview", () => HttpResponse.json(OVERVIEW_DATA)));
    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    expect(screen.getByText(/Total Transactions/i)).toBeInTheDocument();
    expect(screen.getByText(/Income/i)).toBeInTheDocument();
    expect(screen.getByText(/Expenses/i)).toBeInTheDocument();
    expect(screen.getByText(/Net Change/i)).toBeInTheDocument();
    expect(screen.getByText(/Savings Rate/i)).toBeInTheDocument();
  });

  it("shows '—' when savings_rate is null", async () => {
    server.use(
      http.get("/api/overview", () => HttpResponse.json({ ...OVERVIEW_DATA, savings_rate: null }))
    );
    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows error alert when API fails", async () => {
    server.use(
      http.get("/api/overview", () =>
        HttpResponse.json({ detail: "Server error" }, { status: 500 })
      )
    );
    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    );
    await screen.findByText(/API 500/);
  });
});
