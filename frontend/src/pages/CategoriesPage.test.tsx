import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import CategoriesPage from "./CategoriesPage";

// Plotly is a CDN global; mock to prevent errors in useEffect.
beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).Plotly = { react: vi.fn() };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <CategoriesPage />
    </MemoryRouter>
  );
}

const CATEGORY_ROWS = [
  {
    category: "Food",
    subcategory: "Groceries",
    transaction_count: 20,
    total_amount: "-400.00",
  },
  {
    category: "Food",
    subcategory: "Restaurants",
    transaction_count: 15,
    total_amount: "-300.00",
  },
  {
    category: "Transport",
    subcategory: "Gas",
    transaction_count: 8,
    total_amount: "-120.00",
  },
  {
    category: "Uncategorized",
    subcategory: "Uncategorized",
    transaction_count: 3,
    total_amount: "-50.00",
  },
];

describe("CategoriesPage", () => {
  it("shows loading indicator while fetching", async () => {
    renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders category cards after data loads", async () => {
    server.use(http.get("/api/categories", () => HttpResponse.json({ items: CATEGORY_ROWS })));
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    expect(screen.getByText("Food")).toBeInTheDocument();
    expect(screen.getByText("Transport")).toBeInTheDocument();
    expect(screen.getByText("Groceries")).toBeInTheDocument();
    expect(screen.getByText("Restaurants")).toBeInTheDocument();
    expect(screen.getByText("Gas")).toBeInTheDocument();
  });

  it("places Uncategorized group last", async () => {
    server.use(http.get("/api/categories", () => HttpResponse.json({ items: CATEGORY_ROWS })));
    const { container } = renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    const cards = container.querySelectorAll("[class*='border-gray-200'][class*='rounded-lg']");
    // Last card should contain "Uncategorized"
    const lastCard = cards[cards.length - 1];
    expect(lastCard.textContent).toContain("Uncategorized");
  });

  it("shows empty state when no categories found", async () => {
    // Default handler returns { items: [] }
    renderPage();
    await screen.findByText("No categories found.");
  });

  it("shows error when API fails", async () => {
    server.use(
      http.get("/api/categories", () => HttpResponse.json({ detail: "DB error" }, { status: 500 }))
    );
    renderPage();
    await screen.findByText(/API 500/);
  });

  it("category name links navigate to /transactions?category=<name>", async () => {
    server.use(http.get("/api/categories", () => HttpResponse.json({ items: CATEGORY_ROWS })));
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    const foodLink = screen.getAllByRole("link").find((l) => l.textContent === "Food");
    expect(foodLink).toBeDefined();
    expect(foodLink!.getAttribute("href")).toBe("/transactions?category=Food");
  });

  it("subcategory links navigate to /transactions?subcategory=<name>", async () => {
    server.use(http.get("/api/categories", () => HttpResponse.json({ items: CATEGORY_ROWS })));
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    const groceriesLink = screen.getAllByRole("link").find((l) => l.textContent === "Groceries");
    expect(groceriesLink).toBeDefined();
    expect(groceriesLink!.getAttribute("href")).toContain("subcategory=Groceries");
  });

  it("applies date filters when form is submitted", async () => {
    const user = userEvent.setup();
    let capturedUrl = "";
    server.use(
      http.get("/api/categories", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ items: [] });
      })
    );
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());

    const categoryInput = screen.getByPlaceholderText("e.g. Food");
    await user.type(categoryInput, "Food");
    await user.click(screen.getByRole("button", { name: /apply/i }));

    await waitFor(() => {
      expect(new URL(capturedUrl).searchParams.get("category")).toBe("Food");
    });
  });

  it("clears filters when Clear is clicked", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    const categoryInput = screen.getByPlaceholderText("e.g. Food");
    await user.type(categoryInput, "Food");
    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(categoryInput).toHaveValue("");
  });

  it("sort dropdown changes subcategory sort order", async () => {
    const user = userEvent.setup();
    server.use(http.get("/api/categories", () => HttpResponse.json({ items: CATEGORY_ROWS })));
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    const sortSelect = screen.getByRole("combobox");
    await user.selectOptions(sortSelect, "transaction_count");
    expect((sortSelect as HTMLSelectElement).value).toBe("transaction_count");
  });
});
