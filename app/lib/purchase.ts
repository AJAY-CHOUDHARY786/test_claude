/** Decides whether an order returned by Shopify counts as a real purchase for "Verified purchase". */
export interface OrderNode { id?: string; cancelledAt?: string | null; displayFinancialStatus?: string | null }
const PAID = new Set(["PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED"]);

export function isQualifyingOrder(o: OrderNode): boolean {
  return !o.cancelledAt && PAID.has(String(o.displayFinancialStatus ?? "").toUpperCase());
}
export const anyQualifyingOrder = (nodes: OrderNode[]) => nodes.some(isQualifyingOrder);
