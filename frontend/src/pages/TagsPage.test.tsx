import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import TagsPage from "./TagsPage";

function renderPage() {
  return render(
    <MemoryRouter>
      <TagsPage />
    </MemoryRouter>
  );
}

const TAG_1 = {
  name: "food",
  transaction_count: 10,
  total_amount: "-150.00",
};

const TAG_2 = {
  name: "travel",
  transaction_count: 5,
  total_amount: "-500.00",
};

describe("TagsPage", () => {
  it("shows loading indicator while fetching", () => {
    renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders tag rows with name and transaction count", async () => {
    server.use(http.get("/api/tags", () => HttpResponse.json({ items: [TAG_1] })));
    renderPage();
    expect(await screen.findByText("food")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("shows empty state when no tags", async () => {
    // Default handler returns { items: [] }
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    expect(screen.getByText("No tags found.")).toBeInTheDocument();
  });

  it("shows error when API fails", async () => {
    server.use(
      http.get("/api/tags", () => HttpResponse.json({ detail: "Error" }, { status: 500 }))
    );
    renderPage();
    await screen.findByText(/API 500/);
  });

  it("sends name filter to API when Apply is clicked", async () => {
    const user = userEvent.setup();
    let capturedUrl = "";
    server.use(
      http.get("/api/tags", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ items: [] });
      })
    );
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    const nameInput = screen.getByPlaceholderText("e.g. travel");
    await user.type(nameInput, "food");
    capturedUrl = "";
    await user.click(screen.getByRole("button", { name: /apply/i }));
    await waitFor(() => {
      expect(capturedUrl).not.toBe("");
      expect(new URL(capturedUrl).searchParams.get("name")).toBe("food");
    });
  });

  it("clears filter when Clear is clicked", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    const nameInput = screen.getByPlaceholderText("e.g. travel");
    await user.type(nameInput, "food");
    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(nameInput).toHaveValue("");
  });

  it("changes sort column when clicking a column header", async () => {
    const user = userEvent.setup();
    let capturedUrl = "";
    server.use(
      http.get("/api/tags", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ items: [] });
      })
    );
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    capturedUrl = "";
    await user.click(screen.getByRole("button", { name: /transactions/i }));
    await waitFor(() => {
      expect(capturedUrl).not.toBe("");
      expect(new URL(capturedUrl).searchParams.get("sort_by")).toBe("transaction_count");
    });
  });

  it("tag name links to transactions page filtered by tag", async () => {
    server.use(http.get("/api/tags", () => HttpResponse.json({ items: [TAG_1] })));
    renderPage();
    const link = await screen.findByRole("link", { name: "food" });
    expect(link.getAttribute("href")).toContain("tag=food");
  });

  it("renders multiple tag rows", async () => {
    server.use(http.get("/api/tags", () => HttpResponse.json({ items: [TAG_1, TAG_2] })));
    renderPage();
    expect(await screen.findByText("food")).toBeInTheDocument();
    expect(screen.getByText("travel")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });
});
