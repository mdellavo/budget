import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import AccountsPage from "./AccountsPage";

function renderPage() {
  return render(
    <MemoryRouter>
      <AccountsPage />
    </MemoryRouter>
  );
}

const ACCOUNT_1 = {
  id: 1,
  name: "Chase Checking",
  institution: "Chase",
  account_type: "checking",
  created_at: "2024-01-01T00:00:00",
  transaction_count: 100,
  total_amount: "-2500.00",
};

const ACCOUNT_2 = {
  id: 2,
  name: "Wells Savings",
  institution: "Wells Fargo",
  account_type: "savings",
  created_at: "2024-06-01T00:00:00",
  transaction_count: 20,
  total_amount: "5000.00",
};

describe("AccountsPage", () => {
  it("shows loading indicator while fetching", () => {
    renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders account rows with name, institution, type, and transaction count", async () => {
    server.use(
      http.get("/api/accounts", () =>
        HttpResponse.json({
          items: [ACCOUNT_1],
          has_more: false,
          next_cursor: null,
        })
      )
    );
    renderPage();
    expect(await screen.findByText("Chase Checking")).toBeInTheDocument();
    expect(screen.getByText("Chase")).toBeInTheDocument();
    expect(screen.getByText("checking")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("account name links navigate to /transactions?account=<name>", async () => {
    server.use(
      http.get("/api/accounts", () =>
        HttpResponse.json({
          items: [ACCOUNT_1],
          has_more: false,
          next_cursor: null,
        })
      )
    );
    renderPage();
    const link = await screen.findByRole("link", { name: "Chase Checking" });
    expect(link).toHaveAttribute("href", "/transactions?account=Chase%20Checking");
  });

  it("shows empty state when no accounts found", async () => {
    // Default handler returns empty items
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    expect(screen.getByText(/No accounts found/)).toBeInTheDocument();
  });

  it("shows error when API fails", async () => {
    server.use(
      http.get("/api/accounts", () =>
        HttpResponse.json({ detail: "Server error" }, { status: 500 })
      )
    );
    renderPage();
    await screen.findByText(/API 500/);
  });

  it("shows Load more button when hasMore is true and appends items on click", async () => {
    const user = userEvent.setup();
    let callCount = 0;
    server.use(
      http.get("/api/accounts", () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json({
            items: [ACCOUNT_1],
            has_more: true,
            next_cursor: 1,
          });
        }
        return HttpResponse.json({
          items: [ACCOUNT_2],
          has_more: false,
          next_cursor: null,
        });
      })
    );
    renderPage();
    await screen.findByText("Chase Checking");
    const loadMoreBtn = screen.getByRole("button", { name: /load more/i });
    await user.click(loadMoreBtn);
    await screen.findByText("Wells Savings");
    // Original item still in list
    expect(screen.getByText("Chase Checking")).toBeInTheDocument();
  });

  it("does not show Load more button when hasMore is false", async () => {
    server.use(
      http.get("/api/accounts", () =>
        HttpResponse.json({
          items: [ACCOUNT_1],
          has_more: false,
          next_cursor: null,
        })
      )
    );
    renderPage();
    await screen.findByText("Chase Checking");
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("sends name filter to API when form is submitted", async () => {
    const user = userEvent.setup();
    let capturedUrl = "";
    server.use(
      http.get("/api/accounts", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ items: [], has_more: false, next_cursor: null });
      })
    );
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());

    const nameInput = screen.getByPlaceholderText("e.g. Checking");
    await user.type(nameInput, "Chase");
    capturedUrl = ""; // reset after initial fetch
    await user.click(screen.getByRole("button", { name: /apply/i }));

    await waitFor(() => {
      expect(capturedUrl).not.toBe("");
      expect(new URL(capturedUrl).searchParams.get("name")).toBe("Chase");
    });
  });

  it("clears filter inputs when Clear is clicked", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    const nameInput = screen.getByPlaceholderText("e.g. Checking");
    await user.type(nameInput, "Chase");
    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(nameInput).toHaveValue("");
  });

  it("sends sort_by to API when a column header is clicked", async () => {
    const user = userEvent.setup();
    const capturedUrls: string[] = [];
    server.use(
      http.get("/api/accounts", ({ request }) => {
        capturedUrls.push(request.url);
        return HttpResponse.json({ items: [], has_more: false, next_cursor: null });
      })
    );
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    // Click Institution header
    await user.click(screen.getByRole("button", { name: /institution/i }));
    await waitFor(() => {
      const last = capturedUrls[capturedUrls.length - 1];
      expect(new URL(last).searchParams.get("sort_by")).toBe("institution");
    });
  });

  it("reverses sort direction when the same column header is clicked twice", async () => {
    const user = userEvent.setup();
    const capturedUrls: string[] = [];
    server.use(
      http.get("/api/accounts", ({ request }) => {
        capturedUrls.push(request.url);
        return HttpResponse.json({ items: [], has_more: false, next_cursor: null });
      })
    );
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    const institutionBtn = screen.getByRole("button", { name: /institution/i });
    await user.click(institutionBtn);
    await waitFor(() => capturedUrls.length >= 2);
    const firstSortDir = new URL(capturedUrls[capturedUrls.length - 1]).searchParams.get(
      "sort_dir"
    );

    await user.click(institutionBtn);
    await waitFor(() => capturedUrls.length >= 3);
    const secondSortDir = new URL(capturedUrls[capturedUrls.length - 1]).searchParams.get(
      "sort_dir"
    );

    expect(firstSortDir).not.toBe(secondSortDir);
  });
});
