/** Reads Shopify privacy webhook payloads defensively. A request with no identifiers must never match "everything". */
export interface PrivacyTarget { customerId: string | null; orderIds: string[] }

const digits = (v: unknown): string | null => { const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : ""; return /^\d{1,20}$/.test(s) ? s : null; };

export function parsePrivacyPayload(payload: unknown, ordersKey: "orders_requested" | "orders_to_redact"): PrivacyTarget {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const customer = (p.customer && typeof p.customer === "object" ? p.customer : {}) as Record<string, unknown>;
  const list = Array.isArray(p[ordersKey]) ? (p[ordersKey] as unknown[]) : [];
  return { customerId: digits(customer.id), orderIds: list.map(digits).filter((x): x is string => x !== null).slice(0, 500) };
}

/** Prisma `where` for this shop's requests that belong to the target, or null when there is nothing to match. */
export function privacyWhere(shopId: string, t: PrivacyTarget) {
  const or = [...(t.customerId ? [{ shopifyCustomerId: t.customerId }] : []), ...(t.orderIds.length ? [{ shopifyOrderId: { in: t.orderIds } }] : [])];
  return or.length ? { shopId, OR: or } : null;
}
