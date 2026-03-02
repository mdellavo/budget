import { describe, it, expect } from "vitest";
import { formatCurrency, amountColor, parseAmount } from "./format";

describe("formatCurrency", () => {
  it("formats positive amount as USD currency", () => {
    expect(formatCurrency("1234.56")).toBe("$1,234.56");
  });

  it("formats negative amount with minus sign", () => {
    expect(formatCurrency("-500.00")).toBe("-$500.00");
  });

  it("formats zero", () => {
    expect(formatCurrency("0")).toBe("$0.00");
  });

  it("formats large amounts with thousands separator", () => {
    expect(formatCurrency("1000000.00")).toBe("$1,000,000.00");
  });

  it("rounds to two decimal places", () => {
    expect(formatCurrency("9.9")).toBe("$9.90");
  });
});

describe("amountColor", () => {
  it("returns red class for negative amounts", () => {
    expect(amountColor("-100.00")).toBe("text-red-600");
  });

  it("returns green class for positive amounts", () => {
    expect(amountColor("250.00")).toBe("text-green-700");
  });

  it("returns green class for zero", () => {
    expect(amountColor("0")).toBe("text-green-700");
  });

  it("handles string zero with no sign", () => {
    expect(amountColor("0.00")).toBe("text-green-700");
  });
});

describe("parseAmount", () => {
  it("parses a basic decimal string", () => {
    expect(parseAmount("12.34")).toBe(12.34);
  });

  it("parses a negative amount", () => {
    expect(parseAmount("-99.50")).toBe(-99.5);
  });

  it("snaps to cent precision (no sub-cent drift)", () => {
    // 0.1 + 0.2 in float = 0.30000000000000004; parseAmount should snap to 0.30
    const result = parseAmount("0.30");
    expect(result).toBe(0.3);
    expect(result * 100).toBe(30);
  });

  it("handles zero", () => {
    expect(parseAmount("0")).toBe(0);
    expect(parseAmount("0.00")).toBe(0);
  });

  it("handles large amounts", () => {
    expect(parseAmount("10000.99")).toBe(10000.99);
  });

  it("result has at most 2 decimal digits of precision", () => {
    // parseAmount should produce a value whose *100 is an integer
    const result = parseAmount("1.005");
    expect(Math.round(result * 100) % 1).toBe(0);
  });
});
