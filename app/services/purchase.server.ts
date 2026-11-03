import { unauthenticated } from "../shopify.server.ts";
import { anyQualifyingOrder, type OrderNode } from "../lib/purchase.ts";
import { logger } from "../config.server.ts";

/**
 * True only if Shopify says this customer has a paid, uncancelled order containing the product.
 * The customer ID comes from the signed app-proxy query (logged_in_customer_id), so the shopper cannot choose it.
 * Note: with the read_orders scope Shopify only returns orders from roughly the last 60 days.
 * Add read_all_orders (requires Shopify approval) to verify older purchases. Any error means "not verified".
 */
export async function customerBoughtProduct(domain: string, customerId: string, productId: string): Promise<boolean> {
  if (!/^\d{1,20}$/.test(customerId) || !/^\d{1,20}$/.test(productId)) return false;
  try {
    const { admin } = await unauthenticated.admin(domain);
    const res = await admin.graphql(`#graphql
      query Orders($q: String!) { orders(first: 10, query: $q) { nodes { id cancelledAt displayFinancialStatus } } }`,
      { variables: { q: `customer_id:${customerId} product_id:${productId}` } });
    const json = (await res.json()) as { data?: { orders?: { nodes?: OrderNode[] } } };
    return anyQualifyingOrder(json.data?.orders?.nodes ?? []);
  } catch (e) {
    logger.warn("Purchase verification failed; review left unverified", { error: e });
    return false;
  }
}
