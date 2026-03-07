import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import DebugPage from "./DebugPage";
import type { EnrichmentDebugResponse } from "../types";

function renderPage() {
  return render(
    <MemoryRouter>
      <DebugPage />
    </MemoryRouter>
  );
}

const emptyResponse: EnrichmentDebugResponse = {
  imports: [],
  total_input_tokens: 0,
  total_output_tokens: 0,
};

const sampleResponse: EnrichmentDebugResponse = {
  imports: [
    {
      id: 1,
      filename: "checking.csv",
      imported_at: "2024-03-01T10:00:00",
      row_count: 150,
      status: "complete",
      batch_count: 3,
      total_input_tokens: 45000,
      total_output_tokens: 6000,
      batches: [
        {
          id: 1,
          batch_num: 0,
          row_count: 50,
          input_tokens: 15000,
          output_tokens: 2000,
          status: "success",
          started_at: "2024-03-01T10:00:00",
          completed_at: "2024-03-01T10:00:30",
        },
        {
          id: 2,
          batch_num: 1,
          row_count: 50,
          input_tokens: 15000,
          output_tokens: 2000,
          status: "success",
          started_at: "2024-03-01T10:00:30",
          completed_at: "2024-03-01T10:01:00",
        },
        {
          id: 3,
          batch_num: 2,
          row_count: 50,
          input_tokens: 15000,
          output_tokens: 2000,
          status: "failed",
          started_at: "2024-03-01T10:01:00",
          completed_at: "2024-03-01T10:01:30",
        },
      ],
    },
  ],
  total_input_tokens: 45000,
  total_output_tokens: 6000,
};

describe("DebugPage", () => {
  it("shows heading", async () => {
    renderPage();
    expect(await screen.findByText("Enrichment Debug")).toBeInTheDocument();
  });

  it("shows empty state when no batches", async () => {
    renderPage();
    expect(await screen.findByText(/No enrichment batches recorded yet/)).toBeInTheDocument();
  });

  it("shows summary totals", async () => {
    server.use(http.get("/api/debug/enrichment-batches", () => HttpResponse.json(sampleResponse)));
    renderPage();
    // "$0.2250" = (45000/1M)*$3 + (6000/1M)*$15 — appears in summary card and import row
    const costs = await screen.findAllByText("$0.2250");
    expect(costs.length).toBeGreaterThanOrEqual(1);
  });

  it("shows import filename in table", async () => {
    server.use(http.get("/api/debug/enrichment-batches", () => HttpResponse.json(sampleResponse)));
    renderPage();
    expect(await screen.findByText("checking.csv")).toBeInTheDocument();
  });

  it("expands row to show batches on click", async () => {
    server.use(http.get("/api/debug/enrichment-batches", () => HttpResponse.json(sampleResponse)));
    renderPage();
    const row = await screen.findByText("checking.csv");
    await userEvent.click(row);
    // Batch sub-table headers should appear
    expect(screen.getByText("Batch #")).toBeInTheDocument();
    // Should show 3 batches — look for "failed" badge
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("shows error on API failure", async () => {
    server.use(
      http.get("/api/debug/enrichment-batches", () =>
        HttpResponse.json({ detail: "Server error" }, { status: 500 })
      )
    );
    renderPage();
    await screen.findByText(/ApiResponseError|Error|500/i);
  });

  it("shows zero cost with empty data", async () => {
    server.use(http.get("/api/debug/enrichment-batches", () => HttpResponse.json(emptyResponse)));
    renderPage();
    // Cost should show $0.0000
    expect(await screen.findByText("$0.0000")).toBeInTheDocument();
  });
});
