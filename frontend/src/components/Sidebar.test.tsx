import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import { AuthProvider } from "../contexts/AuthContext";
import Sidebar from "./Sidebar";

// Wrap in MemoryRouter (for NavLink) and AuthProvider (for useAuth in Sidebar).
function renderSidebar(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Sidebar />
      </AuthProvider>
    </MemoryRouter>
  );
}

describe("Sidebar", () => {
  it("renders the app title", () => {
    renderSidebar();
    expect(screen.getByText("Budget")).toBeInTheDocument();
  });

  it("renders all navigation links", () => {
    renderSidebar();
    const expectedLabels = [
      "Overview",
      "Transactions",
      "Accounts",
      "Merchants",
      "Categories",
      "Imports",
      "Recurring",
      "Monthly",
    ];
    for (const label of expectedLabels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("links point to the correct routes", () => {
    renderSidebar();
    expect(screen.getByRole("link", { name: /overview/i })).toHaveAttribute("href", "/overview");
    expect(screen.getByRole("link", { name: /transactions/i })).toHaveAttribute(
      "href",
      "/transactions"
    );
    expect(screen.getByRole("link", { name: /accounts/i })).toHaveAttribute("href", "/accounts");
    expect(screen.getByRole("link", { name: /merchants/i })).toHaveAttribute("href", "/merchants");
    expect(screen.getByRole("link", { name: /monthly/i })).toHaveAttribute("href", "/monthly");
  });

  it("applies the active style to the current route's link", () => {
    renderSidebar("/overview");
    expect(screen.getByRole("link", { name: /overview/i })).toHaveClass("bg-indigo-600");
  });

  it("does not apply the active style to non-current route links", () => {
    renderSidebar("/overview");
    expect(screen.getByRole("link", { name: /transactions/i })).not.toHaveClass("bg-indigo-600");
  });

  it("shows no spinner when no imports are in-progress", async () => {
    renderSidebar();
    await waitFor(() => expect(document.querySelector(".animate-spin")).not.toBeInTheDocument());
  });

  it("shows spinner next to Imports when an import is in-progress", async () => {
    server.use(
      http.get("/api/imports", () =>
        HttpResponse.json({
          items: [
            {
              id: 1,
              filename: "bank.csv",
              account: "Checking",
              status: "in-progress",
              imported_at: "2026-02-22",
              row_count: 100,
              enriched_rows: 10,
              transaction_count: 0,
            },
          ],
          has_more: false,
          next_cursor: null,
        })
      )
    );
    renderSidebar();
    await waitFor(() => expect(document.querySelector(".animate-spin")).toBeInTheDocument());
  });
});
