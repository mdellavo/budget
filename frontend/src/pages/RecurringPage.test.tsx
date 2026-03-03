import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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

function renderPageWithUrl(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/recurring" element={<RecurringPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const RECURRING_ITEM = {
  merchant: "Netflix",
  merchant_id: 1,
  category: "Entertainment",
  subcategory: "Streaming",
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
    expect(screen.getAllByText("Entertainment").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Monthly").length).toBeGreaterThan(0);
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

  it("category links navigate to /transactions?category=<name>&is_recurring=true", async () => {
    server.use(http.get("/api/recurring", () => HttpResponse.json({ items: [RECURRING_ITEM] })));
    renderPage();
    const link = await screen.findByRole("link", { name: "Entertainment" });
    expect(link).toHaveAttribute("href", "/transactions?category=Entertainment&is_recurring=true");
  });

  it("subcategory links navigate to /transactions?subcategory=<name>&is_recurring=true", async () => {
    server.use(http.get("/api/recurring", () => HttpResponse.json({ items: [RECURRING_ITEM] })));
    renderPage();
    const link = await screen.findByRole("link", { name: "Streaming" });
    expect(link).toHaveAttribute("href", "/transactions?subcategory=Streaming&is_recurring=true");
  });

  it("shows AI summary card when summary API returns data", async () => {
    server.use(
      http.get("/api/recurring/summary", () =>
        HttpResponse.json({
          narrative: "You spend $200/month on subscriptions.",
          insights: ["Netflix is your largest subscription."],
          recommendations: ["Consider cancelling unused services."],
        })
      )
    );
    renderPage();
    await screen.findByText("You spend $200/month on subscriptions.");
    expect(screen.getByText("AI Summary")).toBeInTheDocument();
  });

  it("does not show AI summary card when summary API returns an error", async () => {
    // Default handler already returns 502.
    renderPage();
    await screen.findByText("No recurring charges detected.");
    expect(screen.queryByText("AI Summary")).not.toBeInTheDocument();
  });

  it("date inputs default to a 6-month range", () => {
    renderPage();
    const fromInput = screen.getByLabelText(/^from$/i) as HTMLInputElement;
    const toInput = screen.getByLabelText(/^to$/i) as HTMLInputElement;
    expect(fromInput.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(toInput.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const from = new Date(fromInput.value);
    const to = new Date(toInput.value);
    const monthDiff =
      (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
    expect(monthDiff).toBe(6);
  });

  it("URL params pre-populate date inputs and drive the initial fetch", async () => {
    let capturedUrl = "";
    server.use(
      http.get("/api/recurring", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ items: [] });
      })
    );
    renderPageWithUrl("/recurring?date_from=2025-01-01&date_to=2025-06-30");
    const fromInput = screen.getByLabelText(/^from$/i) as HTMLInputElement;
    const toInput = screen.getByLabelText(/^to$/i) as HTMLInputElement;
    expect(fromInput.value).toBe("2025-01-01");
    expect(toInput.value).toBe("2025-06-30");
    await waitFor(() => {
      expect(capturedUrl).toContain("date_from=2025-01-01");
      expect(capturedUrl).toContain("date_to=2025-06-30");
    });
  });

  it("changing date inputs and applying calls API with updated params", async () => {
    const user = userEvent.setup();
    let capturedUrl = "";
    server.use(
      http.get("/api/recurring", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ items: [] });
      })
    );
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());

    const fromInput = screen.getByLabelText(/^from$/i);
    const toInput = screen.getByLabelText(/^to$/i);

    await user.clear(fromInput);
    await user.type(fromInput, "2024-01-01");
    await user.clear(toInput);
    await user.type(toInput, "2024-06-30");

    await user.click(screen.getByRole("button", { name: /apply/i }));

    await waitFor(() => {
      expect(capturedUrl).toContain("date_from=2024-01-01");
      expect(capturedUrl).toContain("date_to=2024-06-30");
    });
  });
});
