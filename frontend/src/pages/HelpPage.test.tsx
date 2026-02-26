import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HelpPage from "./HelpPage";

describe("HelpPage", () => {
  it("renders the main heading", () => {
    render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>
    );
    expect(screen.getByText("Help & Documentation")).toBeInTheDocument();
  });

  it("renders all 11 section headings", () => {
    render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Budgets" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Transactions" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Accounts" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Merchants/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Card Holders" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Categories/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Importing Transactions" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recurring Transactions" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Monthly Reports" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Category Trends" })).toBeInTheDocument();
  });

  it("renders table of contents anchor links", () => {
    render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "#overview");
    expect(screen.getByRole("link", { name: "Budgets" })).toHaveAttribute("href", "#budgets");
    expect(screen.getByRole("link", { name: "Importing Transactions" })).toHaveAttribute(
      "href",
      "#imports"
    );
  });
});
