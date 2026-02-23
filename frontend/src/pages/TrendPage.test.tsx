import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import TrendPage from "./TrendPage";

beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).Plotly = { react: vi.fn() };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <TrendPage />
    </MemoryRouter>
  );
}

function renderPageWithUrl(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/trends" element={<TrendPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const SAMPLE_ITEMS = [
  { month: "2025-03", category: "Food & Drink", total: "-120.00" },
  { month: "2025-03", category: "Transport", total: "-45.00" },
  { month: "2025-04", category: "Food & Drink", total: "-130.00" },
  { month: "2025-04", category: "Transport", total: "-50.00" },
];

describe("TrendPage", () => {
  it("shows loading indicator while fetching", () => {
    renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders chart (Plotly.react called) when data is returned", async () => {
    server.use(http.get("/api/category-trends", () => HttpResponse.json({ items: SAMPLE_ITEMS })));
    renderPage();
    await waitFor(() => {
      expect(
        (globalThis as unknown as Record<string, { react: ReturnType<typeof vi.fn> }>).Plotly.react
      ).toHaveBeenCalled();
    });
  });

  it("shows empty state when API returns no items", async () => {
    // Default handler returns { items: [] }
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    expect(screen.getByText("No expense data for the selected period.")).toBeInTheDocument();
  });

  it("shows error when API returns 500", async () => {
    server.use(
      http.get("/api/category-trends", () =>
        HttpResponse.json({ detail: "DB error" }, { status: 500 })
      )
    );
    renderPage();
    await screen.findByText(/API 500/);
  });

  it("month inputs default to a 5-year range", () => {
    renderPage();
    const fromInput = screen.getByLabelText(/month from/i) as HTMLInputElement;
    const toInput = screen.getByLabelText(/month to/i) as HTMLInputElement;
    // Both values should be non-empty YYYY-MM strings
    expect(fromInput.value).toMatch(/^\d{4}-\d{2}$/);
    expect(toInput.value).toMatch(/^\d{4}-\d{2}$/);
    // date_from should be 60 months before date_to (5 years)
    const from = new Date(fromInput.value + "-01");
    const to = new Date(toInput.value + "-01");
    const monthDiff =
      (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
    expect(monthDiff).toBe(60);
  });

  it("URL params pre-populate inputs and drive the initial fetch", async () => {
    let capturedUrl = "";
    server.use(
      http.get("/api/category-trends", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ items: [] });
      })
    );
    renderPageWithUrl("/trends?date_from=2020-01&date_to=2023-06");
    const fromInput = screen.getByLabelText(/month from/i) as HTMLInputElement;
    const toInput = screen.getByLabelText(/month to/i) as HTMLInputElement;
    expect(fromInput.value).toBe("2020-01");
    expect(toInput.value).toBe("2023-06");
    await waitFor(() => {
      expect(capturedUrl).toContain("date_from=2020-01");
      expect(capturedUrl).toContain("date_to=2023-06");
    });
  });

  it("changing month inputs and submitting calls API with updated params", async () => {
    const user = userEvent.setup();
    let capturedUrl = "";
    server.use(
      http.get("/api/category-trends", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ items: [] });
      })
    );
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());

    const fromInput = screen.getByLabelText(/month from/i);
    const toInput = screen.getByLabelText(/month to/i);

    await user.clear(fromInput);
    await user.type(fromInput, "2024-01");
    await user.clear(toInput);
    await user.type(toInput, "2024-06");

    await user.click(screen.getByRole("button", { name: /apply/i }));

    await waitFor(() => {
      expect(capturedUrl).toContain("date_from=2024-01");
      expect(capturedUrl).toContain("date_to=2024-06");
    });
  });

  it("category names appear as trace names when Plotly.react is called", async () => {
    server.use(http.get("/api/category-trends", () => HttpResponse.json({ items: SAMPLE_ITEMS })));
    renderPage();
    const plotlyMock = (
      globalThis as unknown as Record<string, { react: ReturnType<typeof vi.fn> }>
    ).Plotly.react;
    await waitFor(() => {
      expect(plotlyMock).toHaveBeenCalled();
    });
    const [, traces] = plotlyMock.mock.calls[0] as [unknown, Array<{ name: string }>];
    const names = traces.map((t) => t.name);
    expect(names).toContain("Food & Drink");
    expect(names).toContain("Transport");
  });
});
