import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import CardHoldersPage from "./CardHoldersPage";

function renderPage() {
  return render(
    <MemoryRouter>
      <CardHoldersPage />
    </MemoryRouter>
  );
}

const CH_1 = {
  id: 1,
  card_number: "1234",
  name: "Alice",
  transaction_count: 10,
  total_amount: "-150.00",
};

const CH_2 = {
  id: 2,
  card_number: "5678",
  name: null,
  transaction_count: 5,
  total_amount: "-75.00",
};

describe("CardHoldersPage", () => {
  it("shows loading indicator while fetching", () => {
    renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders cardholder rows with card number, name, count, and total", async () => {
    server.use(
      http.get("/api/cardholders", () =>
        HttpResponse.json({ items: [CH_1], has_more: false, next_cursor: null })
      )
    );
    renderPage();
    expect(await screen.findByText("1234")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("-$150.00")).toBeInTheDocument();
  });

  it("shows empty state when no card holders found", async () => {
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    expect(screen.getByText("No card holders found.")).toBeInTheDocument();
  });

  it("shows error when API fails", async () => {
    server.use(
      http.get("/api/cardholders", () => HttpResponse.json({ detail: "Error" }, { status: 500 }))
    );
    renderPage();
    await screen.findByText(/API 500/);
  });

  it("shows Load more button when hasMore is true and appends items on click", async () => {
    const user = userEvent.setup();
    let callCount = 0;
    server.use(
      http.get("/api/cardholders", () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json({ items: [CH_1], has_more: true, next_cursor: 1 });
        }
        return HttpResponse.json({ items: [CH_2], has_more: false, next_cursor: null });
      })
    );
    renderPage();
    await screen.findByText("1234");
    await user.click(screen.getByRole("button", { name: /load more/i }));
    await screen.findByText("5678");
    expect(screen.getByText("1234")).toBeInTheDocument();
  });

  it("opens details modal when card number button is clicked", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/api/cardholders", () =>
        HttpResponse.json({ items: [CH_1], has_more: false, next_cursor: null })
      )
    );
    renderPage();
    await user.click(await screen.findByRole("button", { name: "1234" }));
    expect(screen.getByText("View transactions →")).toBeInTheDocument();
  });

  it("details modal shows view transactions link with card number", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/api/cardholders", () =>
        HttpResponse.json({ items: [CH_1], has_more: false, next_cursor: null })
      )
    );
    renderPage();
    await user.click(await screen.findByRole("button", { name: "1234" }));
    const link = screen.getByRole("link", { name: /View transactions/i });
    expect(link.getAttribute("href")).toContain("cardholder=1234");
  });

  it("opens edit modal when pencil button is clicked", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/api/cardholders", () =>
        HttpResponse.json({ items: [CH_1], has_more: false, next_cursor: null })
      )
    );
    renderPage();
    await screen.findByText("1234");
    await user.click(screen.getByTitle("Edit card holder"));
    expect(screen.getByText("Edit card holder")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1234")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Alice")).toBeInTheDocument();
  });

  it("saves cardholder edit and updates row in list", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/api/cardholders", () =>
        HttpResponse.json({ items: [CH_1], has_more: false, next_cursor: null })
      ),
      http.patch("/api/cardholders/1", async ({ request }) => {
        const body = (await request.json()) as { name: string | null; card_number: string | null };
        return HttpResponse.json({ ...CH_1, name: body.name });
      })
    );
    renderPage();
    await screen.findByText("1234");
    await user.click(screen.getByTitle("Edit card holder"));
    const nameInput = screen.getByDisplayValue("Alice");
    await user.clear(nameInput);
    await user.type(nameInput, "Bob");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await screen.findByText("Bob");
    await waitFor(() => expect(screen.queryByText("Alice")).not.toBeInTheDocument());
  });

  it("sends card_number filter to API when form is submitted", async () => {
    const user = userEvent.setup();
    let capturedUrl = "";
    server.use(
      http.get("/api/cardholders", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ items: [], has_more: false, next_cursor: null });
      })
    );
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    const input = screen.getByPlaceholderText("e.g. 1234");
    await user.type(input, "12");
    capturedUrl = "";
    await user.click(screen.getByRole("button", { name: /apply/i }));
    await waitFor(() => {
      expect(capturedUrl).not.toBe("");
      expect(new URL(capturedUrl).searchParams.get("card_number")).toBe("12");
    });
  });

  it("clears filter inputs when Clear is clicked", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    const input = screen.getByPlaceholderText("e.g. 1234");
    await user.type(input, "12");
    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(input).toHaveValue("");
  });
});
