import { unauthenticated } from "../shopify.server.ts";

const cache = new Map<string, { title: string | null; at: number }>();

/** Product name for a storefront or link page, looked up with the shop's own offline access token. Cached for an hour. */
export async function productTitle(domain: string, productId: string): Promise<string | null> {
  const key = `${domain}:${productId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.title;
  let title: string | null = null;
  try {
    const { admin } = await unauthenticated.admin(domain);
    const res = await admin.graphql(`#graphql query P($id: ID!) { product(id: $id) { title } }`, { variables: { id: `gid://shopify/Product/${productId}` } });
    title = ((await res.json()) as { data?: { product?: { title?: string } | null } }).data?.product?.title ?? null;
  } catch { /* optional */ }
  if (cache.size > 2000) cache.clear();
  cache.set(key, { title, at: Date.now() });
  return title;
}
