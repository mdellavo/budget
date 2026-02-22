import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import MerchantMergePage from "./MerchantMergePage";

function renderPage() {
  return render(<MerchantMergePage />);
}

const MERGE_GROUP = {
  canonical_name: "Starbucks",
  canonical_location: null,
  members: [
    { id: 1, name: "STARBUCKS", location: null, transaction_count: 10 },
    { id: 2, name: "Starbucks Coffee", location: "Seattle", transaction_count: 5 },
  ],
};

describe("MerchantMergePage", () => {
  it("renders the Find duplicates button initially", () => {
    renderPage();
    expect(screen.getByRole("button", { name: /find duplicates/i })).toBeInTheDocument();
  });

  it("renders group cards with merchant names and transaction counts", async () => {
    server.use(
      http.post("/api/ai/find-duplicate-merchants", () =>
        HttpResponse.json({ groups: [MERGE_GROUP] })
      )
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /find duplicates/i }));
    expect(await screen.findByText("STARBUCKS")).toBeInTheDocument();
    expect(screen.getByText("Starbucks Coffee")).toBeInTheDocument();
    expect(screen.getByText("10 transactions")).toBeInTheDocument();
    expect(screen.getByText("5 transactions")).toBeInTheDocument();
  });

  it("shows 'No duplicate groups found.' when empty groups returned", async () => {
    server.use(
      http.post("/api/ai/find-duplicate-merchants", () => HttpResponse.json({ groups: [] }))
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /find duplicates/i }));
    expect(await screen.findByText("No duplicate groups found.")).toBeInTheDocument();
  });

  it("canonical name input is pre-filled with the suggested name", async () => {
    server.use(
      http.post("/api/ai/find-duplicate-merchants", () =>
        HttpResponse.json({ groups: [MERGE_GROUP] })
      )
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /find duplicates/i }));
    await screen.findByText("STARBUCKS");
    // The "Merge into" text input should be pre-filled with canonical_name
    expect(screen.getByDisplayValue("Starbucks")).toBeInTheDocument();
  });

  it("merge button is disabled when fewer than 2 members are selected", async () => {
    server.use(
      http.post("/api/ai/find-duplicate-merchants", () =>
        HttpResponse.json({ groups: [MERGE_GROUP] })
      )
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /find duplicates/i }));
    await screen.findByText("STARBUCKS");

    // Uncheck both checkboxes to deselect all
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);

    expect(screen.getByRole("button", { name: /merge →/i })).toBeDisabled();
  });

  it("skip button marks group as skipped with a badge", async () => {
    server.use(
      http.post("/api/ai/find-duplicate-merchants", () =>
        HttpResponse.json({ groups: [MERGE_GROUP] })
      )
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /find duplicates/i }));
    await screen.findByText("STARBUCKS");
    await user.click(screen.getByRole("button", { name: /skip/i }));
    expect(screen.getByText("Skipped")).toBeInTheDocument();
  });

  it("merge button calls the merge API and shows done banner", async () => {
    server.use(
      http.post("/api/ai/find-duplicate-merchants", () =>
        HttpResponse.json({ groups: [MERGE_GROUP] })
      ),
      http.post("/api/merchants/merge", () =>
        HttpResponse.json({
          id: 1,
          name: "Starbucks",
          location: null,
          transaction_count: 15,
        })
      )
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /find duplicates/i }));
    await screen.findByText("STARBUCKS");
    await user.click(screen.getByRole("button", { name: /merge →/i }));
    await screen.findByText(/Done —/);
    expect(screen.getByText(/1 merged/)).toBeInTheDocument();
  });

  it("shows done banner with skipped count after skipping", async () => {
    server.use(
      http.post("/api/ai/find-duplicate-merchants", () =>
        HttpResponse.json({ groups: [MERGE_GROUP] })
      )
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /find duplicates/i }));
    await screen.findByText("STARBUCKS");
    await user.click(screen.getByRole("button", { name: /skip/i }));
    await screen.findByText(/Done —/);
    expect(screen.getByText(/1 skipped/)).toBeInTheDocument();
  });

  it("shows error when find duplicates API fails", async () => {
    server.use(
      http.post("/api/ai/find-duplicate-merchants", () =>
        HttpResponse.json({ detail: "Analysis failed" }, { status: 500 })
      )
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /find duplicates/i }));
    await screen.findByText(/API 500/);
  });

  it("shows group-level error when the merge API fails", async () => {
    server.use(
      http.post("/api/ai/find-duplicate-merchants", () =>
        HttpResponse.json({ groups: [MERGE_GROUP] })
      ),
      http.post("/api/merchants/merge", () =>
        HttpResponse.json({ detail: "Conflict" }, { status: 409 })
      )
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /find duplicates/i }));
    await screen.findByText("STARBUCKS");
    await user.click(screen.getByRole("button", { name: /merge →/i }));
    await screen.findByText(/API 409/);
  });

  it("sends updated canonical name to the merge API", async () => {
    let capturedBody: unknown = null;
    server.use(
      http.post("/api/ai/find-duplicate-merchants", () =>
        HttpResponse.json({ groups: [MERGE_GROUP] })
      ),
      http.post("/api/merchants/merge", async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          id: 1,
          name: "Updated Name",
          location: null,
          transaction_count: 15,
        });
      })
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /find duplicates/i }));
    await screen.findByText("STARBUCKS");

    // Update the canonical name
    const nameInput = screen.getByDisplayValue("Starbucks");
    await user.clear(nameInput);
    await user.type(nameInput, "Updated Name");

    await user.click(screen.getByRole("button", { name: /merge →/i }));
    await screen.findByText(/Done —/);

    expect((capturedBody as { canonical_name: string }).canonical_name).toBe("Updated Name");
  });
});
