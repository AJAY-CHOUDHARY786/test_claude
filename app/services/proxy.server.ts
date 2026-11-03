import { env } from "../config.server.ts";
import { verifyAppProxySignature } from "../lib/app-proxy.ts";
import { shopByDomainActive } from "./shop.server.ts";
import { getEntitlements } from "./billing.server.ts";

/** Every storefront request must pass this. The shop domain is only trusted because it is part of the signed query. */
export async function authenticateProxy(request: Request) {
  const url = new URL(request.url);
  if (!verifyAppProxySignature(url.searchParams, env.shopifyApiSecret, new Date())) return null;
  const domain = url.searchParams.get("shop");
  if (!domain) return null;
  const shop = await shopByDomainActive(domain);
  if (!shop) return null;
  return { url, shop, ent: await getEntitlements(shop.id) };
}

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", ...headers } });

export async function readJsonBody(request: Request, maxBytes = 20_000): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}
