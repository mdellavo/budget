import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Sidebar from "./Sidebar";

// Wrap in MemoryRouter because Sidebar uses NavLink from react-router-dom.
function renderSidebar(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Sidebar />
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
      "Merge duplicates",
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
});
