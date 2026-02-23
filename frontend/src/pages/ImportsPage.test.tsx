import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import ImportsPage from "./ImportsPage";

function renderPage() {
  return render(
    <MemoryRouter>
      <ImportsPage />
    </MemoryRouter>
  );
}

const IMPORT_ITEM_COMPLETE = {
  id: 1,
  filename: "chase_2026.csv",
  account: "Chase Checking",
  imported_at: "2026-02-10T12:00:00",
  row_count: 50,
  enriched_rows: 50,
  transaction_count: 48,
  status: "complete",
};

const IMPORT_ITEM_IN_PROGRESS = {
  id: 2,
  filename: "wells_2026.csv",
  account: "Wells Savings",
  imported_at: "2026-02-11T10:00:00",
  row_count: 100,
  enriched_rows: 30,
  transaction_count: 0,
  status: "in-progress",
};

const CSV_RESPONSE = {
  csv_import_id: 99,
  filename: "test.csv",
  rows_imported: 10,
  columns: ["Date", "Description", "Amount"],
  column_mapping: { date: 0, description: 1, amount: 2 },
  status: "processing",
};

describe("ImportsPage", () => {
  it("shows loading indicator while fetching", () => {
    renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders import rows with filename, account, and status", async () => {
    server.use(
      http.get("/api/imports", () =>
        HttpResponse.json({
          items: [IMPORT_ITEM_COMPLETE],
          has_more: false,
          next_cursor: null,
        })
      )
    );
    renderPage();
    expect(await screen.findByText("chase_2026.csv")).toBeInTheDocument();
    expect(screen.getByText("Chase Checking")).toBeInTheDocument();
    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument(); // row_count
  });

  it("shows empty state when no imports", async () => {
    // Default handler returns { items: [] }
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    // "No imports yet." is in a TD alongside a button, so match via textContent
    await waitFor(() => {
      expect(document.body.textContent).toContain("No imports yet.");
    });
  });

  it("shows error when API fails", async () => {
    server.use(
      http.get("/api/imports", () => HttpResponse.json({ detail: "DB error" }, { status: 500 }))
    );
    renderPage();
    await screen.findByText(/API 500/);
  });

  it("transaction count is a link to /transactions?import_id=<id>", async () => {
    server.use(
      http.get("/api/imports", () =>
        HttpResponse.json({
          items: [IMPORT_ITEM_COMPLETE],
          has_more: false,
          next_cursor: null,
        })
      )
    );
    renderPage();
    await screen.findByText("chase_2026.csv");
    const txnLink = screen.getByRole("link", { name: "48" });
    expect(txnLink).toHaveAttribute("href", "/transactions?import_id=1");
  });

  it("shows Import CSV button and reveals import form on click", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /import csv/i }));
    expect(screen.getByLabelText(/account name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/csv file/i)).toBeInTheDocument();
  });

  it("shows validation error when submitting without a file", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /import csv/i }));
    await user.type(screen.getByLabelText(/account name/i), "Chase");
    await user.click(screen.getByRole("button", { name: /^import$/i }));
    await screen.findByText(/Please select a CSV file/i);
  });

  it("shows validation error when submitting without account name", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /import csv/i }));
    // Attach a file but no account name
    const fileInput = screen.getByLabelText(/csv file/i);
    const file = new File(["date,description,amount"], "test.csv", {
      type: "text/csv",
    });
    await user.upload(fileInput, file);
    await user.click(screen.getByRole("button", { name: /^import$/i }));
    await screen.findByText(/Please enter an account name/i);
  });

  it("shows success panel with column mapping after a successful import", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/api/imports", () =>
        HttpResponse.json({ items: [], has_more: false, next_cursor: null })
      ),
      http.post("/api/import-csv", () => HttpResponse.json(CSV_RESPONSE)),
      http.get("/api/imports/99/progress", () =>
        HttpResponse.json({
          csv_import_id: 99,
          row_count: 10,
          enriched_rows: 10,
          complete: true,
        })
      )
    );
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /import csv/i }));

    await user.type(screen.getByLabelText(/account name/i), "Chase");
    const fileInput = screen.getByLabelText(/csv file/i);
    const file = new File(["date,description,amount\n2026-01-01,Coffee,-5"], "test.csv", {
      type: "text/csv",
    });
    await user.upload(fileInput, file);
    await user.click(screen.getByRole("button", { name: /^import$/i }));

    await screen.findByText("Import started");
    expect(screen.getByText("test.csv")).toBeInTheDocument();
    // Column mapping table — "Date"/"Description"/"Amount" appear twice
    // (target column + CSV column value), so use getAllByText
    expect(screen.getAllByText("Date").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Description").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Amount").length).toBeGreaterThan(0);
    expect(screen.getByText("Detected column mapping")).toBeInTheDocument();
  });

  it("shows in-progress enrichment bar in the list", async () => {
    server.use(
      http.get("/api/imports", () =>
        HttpResponse.json({
          items: [IMPORT_ITEM_IN_PROGRESS],
          has_more: false,
          next_cursor: null,
        })
      )
    );
    renderPage();
    await screen.findByText("wells_2026.csv");
    expect(screen.getByText("Enriching…")).toBeInTheDocument();
    expect(screen.getByText("30/100")).toBeInTheDocument();
  });

  it("shows Load more button when hasMore is true", async () => {
    const user = userEvent.setup();
    let callCount = 0;
    server.use(
      http.get("/api/imports", () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json({
            items: [IMPORT_ITEM_COMPLETE],
            has_more: true,
            next_cursor: 1,
          });
        }
        return HttpResponse.json({
          items: [{ ...IMPORT_ITEM_IN_PROGRESS, status: "complete", id: 3 }],
          has_more: false,
          next_cursor: null,
        });
      })
    );
    renderPage();
    await screen.findByText("chase_2026.csv");
    const btn = screen.getByRole("button", { name: /load more/i });
    await user.click(btn);
    await screen.findByText("wells_2026.csv");
  });

  it("closes import form and resets it on Cancel click", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /import csv/i }));
    expect(screen.getByLabelText(/account name/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByLabelText(/account name/i)).not.toBeInTheDocument();
  });

  it("shows Re-enrich button on complete imports", async () => {
    server.use(
      http.get("/api/imports", () =>
        HttpResponse.json({
          items: [IMPORT_ITEM_COMPLETE],
          has_more: false,
          next_cursor: null,
        })
      )
    );
    renderPage();
    await screen.findByText("Complete");
    expect(screen.getByRole("button", { name: /re-enrich/i })).toBeInTheDocument();
  });

  it("does not show Re-enrich button on in-progress imports", async () => {
    server.use(
      http.get("/api/imports", () =>
        HttpResponse.json({
          items: [IMPORT_ITEM_IN_PROGRESS],
          has_more: false,
          next_cursor: null,
        })
      )
    );
    renderPage();
    await screen.findByText("Enriching…");
    expect(screen.queryByRole("button", { name: /re-enrich/i })).not.toBeInTheDocument();
  });

  it("clicking Re-enrich calls API and optimistically switches row to in-progress", async () => {
    const user = userEvent.setup();
    let apiCalled = false;
    server.use(
      http.get("/api/imports", () =>
        HttpResponse.json({
          items: [IMPORT_ITEM_COMPLETE],
          has_more: false,
          next_cursor: null,
        })
      ),
      http.post(`/api/imports/${IMPORT_ITEM_COMPLETE.id}/re-enrich`, () => {
        apiCalled = true;
        return HttpResponse.json({
          status: "processing",
          csv_import_id: IMPORT_ITEM_COMPLETE.id,
        });
      })
    );
    renderPage();
    await screen.findByText("Complete");
    await user.click(screen.getByRole("button", { name: /re-enrich/i }));
    expect(apiCalled).toBe(true);
    await waitFor(() => expect(screen.queryByText("Complete")).not.toBeInTheDocument());
  });

  it("shows in-progress enrichment text in the success panel immediately after import", async () => {
    // Verify the initial enrichment progress display before any polling occurs.
    const user = userEvent.setup();

    server.use(
      http.get("/api/imports", () =>
        HttpResponse.json({ items: [], has_more: false, next_cursor: null })
      ),
      http.post("/api/import-csv", () => HttpResponse.json(CSV_RESPONSE)),
      // Progress endpoint — never called in this test since we check immediate state
      http.get("/api/imports/:id/progress", () =>
        HttpResponse.json({
          csv_import_id: 99,
          row_count: 10,
          enriched_rows: 0,
          complete: false,
        })
      )
    );

    renderPage();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /import csv/i }));
    await user.type(screen.getByLabelText(/account name/i), "Chase");
    const file = new File(["date,desc,amount"], "test.csv", { type: "text/csv" });
    await user.upload(screen.getByLabelText(/csv file/i), file);
    await user.click(screen.getByRole("button", { name: /^import$/i }));

    await screen.findByText("Import started");
    // The success panel shows enrichment progress immediately (before any poll)
    expect(screen.getByText(/Enriching 0 \/ 10 rows/)).toBeInTheDocument();
  });
});
