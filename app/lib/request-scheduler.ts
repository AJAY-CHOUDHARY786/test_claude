/** Decides which review requests an order should produce and whether a queued one may still be sent. */
export interface OrderForRequests {
  orderId: string;
  fulfilledAt: Date;
  cancelled: boolean;
  isTest: boolean;
  email: string | null;
  lineItems: { productId: string | null; title: string }[];
}
export interface RequestSettings {
  enabled: boolean;
  delayDays: number;
  maxProductsPerOrder: number;
  excludedProductIds: string[];
}
export interface PlannedRequest { orderId: string; productId: string; productTitle: string; sendAt: Date }
export type SkipReason = "disabled" | "cancelled" | "test_order" | "no_email" | "suppressed" | "no_eligible_products";

export function planReviewRequests(
  order: OrderForRequests,
  settings: RequestSettings,
  isSuppressed: (email: string) => boolean,
): { requests: PlannedRequest[]; skipped: SkipReason | null } {
  if (!settings.enabled) return { requests: [], skipped: "disabled" };
  if (order.cancelled) return { requests: [], skipped: "cancelled" };
  if (order.isTest) return { requests: [], skipped: "test_order" };
  if (!order.email) return { requests: [], skipped: "no_email" };
  if (isSuppressed(order.email)) return { requests: [], skipped: "suppressed" };

  const delay = Math.min(90, Math.max(0, Math.floor(settings.delayDays)));
  const sendAt = new Date(order.fulfilledAt.getTime() + delay * 86_400_000);
  const excluded = new Set(settings.excludedProductIds);
  const seen = new Set<string>();
  const requests: PlannedRequest[] = [];
  for (const item of order.lineItems) {
    if (!item.productId || excluded.has(item.productId) || seen.has(item.productId)) continue;
    seen.add(item.productId);
    requests.push({ orderId: order.orderId, productId: item.productId, productTitle: item.title, sendAt });
    if (requests.length >= Math.max(1, settings.maxProductsPerOrder)) break;
  }
  return requests.length ? { requests, skipped: null } : { requests: [], skipped: "no_eligible_products" };
}

export type SendDecision = "send" | "not_queued" | "cancelled" | "suppressed" | "not_entitled" | "not_due";

export function decideSend(req: { status: string; cancelledAt: Date | null; sendAt: Date }, ctx: { suppressed: boolean; entitled: boolean; now: Date }): SendDecision {
  if (req.status !== "QUEUED") return "not_queued";
  if (req.cancelledAt) return "cancelled";
  if (req.sendAt.getTime() > ctx.now.getTime()) return "not_due";
  if (ctx.suppressed) return "suppressed";
  if (!ctx.entitled) return "not_entitled";
  return "send";
}

/** Exponential backoff: 5 min, 20 min, 80 min, ... capped at 24 hours. Returns null once attempts are exhausted. */
export function nextRetryAt(attempts: number, now: Date, maxAttempts = 5): Date | null {
  if (attempts >= maxAttempts) return null;
  const minutes = Math.min(24 * 60, 5 * 4 ** Math.max(0, attempts - 1));
  return new Date(now.getTime() + minutes * 60_000);
}
