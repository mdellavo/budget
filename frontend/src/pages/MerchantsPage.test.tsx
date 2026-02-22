import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import MerchantsPage from "./MerchantsPage";

function renderPage() {
  return render(
    <MemoryRouter>
      <MerchantsPage />
    </MemoryRouter>
  );
}

const MERCHANT_1 = {
  id: 1,
  name: "Starbucks",
  location: "Seattle, WA",
  transaction_count: 45,
  total_amount: "-450.00",
};

const MERCHANT_2 = {
  id: 2,
  name: "Amazon",
  location: null,
  transaction_count: 30,
  total_amount: "-300.00",
};

describe("MerchantsPage", () => {
  it("shows loading indicator while fetching", () => {
    renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders merchant rows with name, location, and transaction count", async () => {
    server.use(
      http.get("/api/merchants", () =>
        HttpResponse.json({ items: [MERCHANT_1], has_more: false, next_cursor: null })
      )
    );
    renderPage();
    expect(await screen.findByText("Starbucks")).toBeInTheDocument();
    expect(screen.getByText("Seattle, WA")).toBeInTheDocument();
    expect(screen.getByText("45")).toBeInTheDocument();
  });

  it("shows empty state when no merchants found", async () => {
    // Default handler returns { items: [] }
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    expect(screen.getByText("No merchants found.")).toBeInTheDocument();
  });

  it("shows error when API fails", async () => {
    server.use(
      http.get("/api/merchants", () => HttpResponse.json({ detail: "Error" }, { status: 500 }))
    );
    renderPage();
    await screen.findByText(/API 500/);
  });

  it("shows Load more button when hasMore is true and appends items on click", async () => {
    const user = userEvent.setup();
    let callCount = 0;
    server.use(
      http.get("/api/merchants", () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json({
            items: [MERCHANT_1],
            has_more: true,
            next_cursor: 1,
          });
        }
        return HttpResponse.json({
          items: [MERCHANT_2],
          has_more: false,
          next_cursor: null,
        });
      })
    );
    renderPage();
    await screen.findByText("Starbucks");
    await user.click(screen.getByRole("button", { name: /load more/i }));
    await screen.findByText("Amazon");
    expect(screen.getByText("Starbucks")).toBeInTheDocument();
  });

  it("opens details modal when merchant name button is clicked", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/api/merchants", () =>
        HttpResponse.json({ items: [MERCHANT_1], has_more: false, next_cursor: null })
      )
    );
    renderPage();
    await user.click(await screen.findByText("Starbucks"));
    // Details modal visible
    expect(screen.getByText("View transactions →")).toBeInTheDocument();
  });

  it("details modal shows view transactions link for the merchant", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/api/merchants", () =>
        HttpResponse.json({ items: [MERCHANT_1], has_more: false, next_cursor: null })
      )
    );
    renderPage();
    await user.click(await screen.findByText("Starbucks"));
    const link = screen.getByRole("link", { name: /View transactions/i });
    expect(link.getAttribute("href")).toContain("merchant=Starbucks");
  });

  it("opens edit modal when pencil button is clicked", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/api/merchants", () =>
        HttpResponse.json({ items: [MERCHANT_1], has_more: false, next_cursor: null })
      )
    );
    renderPage();
    await screen.findByText("Starbucks");
    await user.click(screen.getByTitle("Edit merchant"));
    // Edit modal visible with pre-filled name
    expect(screen.getByText("Edit merchant")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Starbucks")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Seattle, WA")).toBeInTheDocument();
  });

  it("saves merchant edit and updates name in list", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/api/merchants", () =>
        HttpResponse.json({ items: [MERCHANT_1], has_more: false, next_cursor: null })
      ),
      http.patch("/api/merchants/1", async ({ request }) => {
        const body = (await request.json()) as { name: string; location: string | null };
        return HttpResponse.json({ ...MERCHANT_1, name: body.name });
      })
    );
    renderPage();
    await screen.findByText("Starbucks");
    await user.click(screen.getByTitle("Edit merchant"));

    const nameInput = screen.getByDisplayValue("Starbucks");
    await user.clear(nameInput);
    await user.type(nameInput, "Starbucks Coffee");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await screen.findByText("Starbucks Coffee");
  });

  it("sends name filter to API when form is submitted", async () => {
    const user = userEvent.setup();
    let capturedUrl = "";
    server.use(
      http.get("/api/merchants", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ items: [], has_more: false, next_cursor: null });
      })
    );
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    const nameInput = screen.getByPlaceholderText("e.g. Starbucks");
    await user.type(nameInput, "star");
    capturedUrl = "";
    await user.click(screen.getByRole("button", { name: /apply/i }));
    await waitFor(() => {
      expect(capturedUrl).not.toBe("");
      expect(new URL(capturedUrl).searchParams.get("name")).toBe("star");
    });
  });

  it("clears filter inputs when Clear is clicked", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    const nameInput = screen.getByPlaceholderText("e.g. Starbucks");
    await user.type(nameInput, "star");
    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(nameInput).toHaveValue("");
  });
});
