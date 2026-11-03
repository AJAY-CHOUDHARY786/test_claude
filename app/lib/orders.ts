/** Maps an orders/fulfilled webhook payload to the shape the request scheduler needs. Payloads are untrusted input. */
import type { OrderForRequests } from "./request-scheduler.ts";

export interface OrderWebhookPayload {
  id?: number | string; email?: string | null; test?: boolean; cancelled_at?: string | null; updated_at?: string | null;
  fulfillments?: { created_at?: string | null }[];
  customer?: { id?: number | string; first_name?: string | null } | null;
  line_items?: { product_id?: number | string | null; title?: string | null }[];
}

const asDate = (s: string | null | undefined): Date | null => { if (!s) return null; const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d; };

export function toOrderForRequests(p: OrderWebhookPayload, now = new Date()): OrderForRequests | null {
  if (p.id === undefined || p.id === null || String(p.id).trim() === "") return null;
  // The fulfilment time is the newest fulfillment; fall back to the order's last update, then to now.
  const fulfilments = (p.fulfillments ?? []).map((f) => asDate(f.created_at)).filter((d): d is Date => d !== null);
  const newest = fulfilments.length ? new Date(Math.max(...fulfilments.map((d) => d.getTime()))) : null;
  const email = typeof p.email === "string" ? p.email.trim().slice(0, 254) : "";
  return {
    orderId: String(p.id),
    fulfilledAt: newest ?? asDate(p.updated_at) ?? now,
    cancelled: Boolean(p.cancelled_at),
    isTest: Boolean(p.test),
    email: /^[^\s@]+@[^\s@]+$/.test(email) ? email : null,
    lineItems: (p.line_items ?? []).map((li) => ({ productId: li.product_id ? String(li.product_id) : null, title: String(li.title ?? "your item").slice(0, 200) })),
  };
}
