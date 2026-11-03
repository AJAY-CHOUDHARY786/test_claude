/** Verifies that a storefront request really came through Shopify's app proxy. */
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyAppProxySignature(query: URLSearchParams, secret: string, now: Date, maxAgeSeconds = 300): boolean {
  const signature = query.get("signature");
  if (!signature || !secret) return false;
  const ts = Number(query.get("timestamp"));
  if (!Number.isFinite(ts) || Math.abs(now.getTime() / 1000 - ts) > maxAgeSeconds) return false;

  const grouped = new Map<string, string[]>();
  for (const [k, v] of query.entries()) {
    if (k === "signature") continue;
    grouped.set(k, [...(grouped.get(k) ?? []), v]);
  }
  const message = [...grouped.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v.join(",")}`)
    .join("");
  const expected = createHmac("sha256", secret).update(message).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
