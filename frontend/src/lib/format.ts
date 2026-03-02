export function formatCurrency(val: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(val));
}

export function amountColor(val: string): string {
  return Number(val) < 0 ? "text-red-600" : "text-green-700";
}

/**
 * Parse a decimal amount string to a number snapped to cent precision.
 * Use this instead of bare parseFloat() when the value will be used in arithmetic.
 */
export function parseAmount(val: string): number {
  return Math.round(parseFloat(val) * 100) / 100;
}
