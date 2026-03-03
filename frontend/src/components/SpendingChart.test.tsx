import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import SpendingChart from "./SpendingChart";
import type { CategoryBreakdown } from "../types";

const mockPlotlyReact = vi.fn();

beforeEach(() => {
  mockPlotlyReact.mockClear();
  (globalThis as unknown as Record<string, unknown>).Plotly = { react: mockPlotlyReact };
});

const BREAKDOWN: CategoryBreakdown[] = [
  {
    category: "Food & Drink",
    total: "-800.00",
    pct_change: 10.0,
    subcategories: [
      { subcategory: "Restaurants", total: "-500.00", pct_change: 5.0 },
      { subcategory: "Groceries", total: "-300.00", pct_change: null },
    ],
  },
  {
    category: "Transport",
    total: "-200.00",
    pct_change: null,
    subcategories: [{ subcategory: "Fuel", total: "-200.00", pct_change: null }],
  },
];

describe("SpendingChart", () => {
  it("renders a div container", () => {
    const { container } = render(<SpendingChart breakdown={BREAKDOWN} />);
    const div = container.querySelector("div");
    expect(div).not.toBeNull();
  });

  it("calls Plotly.react with sunburst trace", () => {
    render(<SpendingChart breakdown={BREAKDOWN} />);
    expect(mockPlotlyReact).toHaveBeenCalledOnce();
    const [, dataArg] = mockPlotlyReact.mock.calls[0] as [unknown, object[]];
    expect(dataArg).toHaveLength(1);
    const trace = dataArg[0] as { type: string; ids: string[]; labels: string[]; values: number[] };
    expect(trace.type).toBe("sunburst");
  });

  it("includes category and subcategory labels in the trace", () => {
    render(<SpendingChart breakdown={BREAKDOWN} />);
    const [, dataArg] = mockPlotlyReact.mock.calls[0] as [unknown, object[]];
    const trace = dataArg[0] as { labels: string[] };
    expect(trace.labels).toContain("Food & Drink");
    expect(trace.labels).toContain("Restaurants");
    expect(trace.labels).toContain("Transport");
    expect(trace.labels).toContain("Fuel");
  });

  it("uses absolute values for sunburst values", () => {
    render(<SpendingChart breakdown={BREAKDOWN} />);
    const [, dataArg] = mockPlotlyReact.mock.calls[0] as [unknown, object[]];
    const trace = dataArg[0] as { values: number[] };
    // All values should be positive (absolute amounts)
    expect(trace.values.every((v: number) => v >= 0)).toBe(true);
    expect(trace.values).toContain(800);
    expect(trace.values).toContain(500);
    expect(trace.values).toContain(200);
  });

  it("handles empty breakdown without error", () => {
    expect(() => render(<SpendingChart breakdown={[]} />)).not.toThrow();
    expect(mockPlotlyReact).toHaveBeenCalledOnce();
    const [, dataArg] = mockPlotlyReact.mock.calls[0] as [unknown, object[]];
    const trace = dataArg[0] as { ids: string[] };
    expect(trace.ids).toHaveLength(0);
  });

  it("sets parent-child relationships correctly", () => {
    render(<SpendingChart breakdown={BREAKDOWN} />);
    const [, dataArg] = mockPlotlyReact.mock.calls[0] as [unknown, object[]];
    const trace = dataArg[0] as { ids: string[]; parents: string[] };
    // Top-level categories have empty parent
    const foodIdx = trace.ids.indexOf("Food & Drink");
    expect(trace.parents[foodIdx]).toBe("");
    // Subcategories have category as parent
    const restIdx = trace.ids.indexOf("Food & Drink/Restaurants");
    expect(trace.parents[restIdx]).toBe("Food & Drink");
  });
});
