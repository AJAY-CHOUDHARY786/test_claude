import prisma from "../db.server.ts";
import { env, logger } from "../config.server.ts";
import { resolveEntitlements, type SubscriptionState, type SubscriptionStatus } from "../lib/plans.ts";
import { pickSubscription, type ShopifySubscription } from "../lib/subscription-sync.ts";

type Graphql = (q: string) => Promise<Response>;

const QUERY = `#graphql
  query ActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions { id name status trialDays createdAt currentPeriodEnd test }
    }
  }`;

/** Reads the truth from Shopify and stores a local copy. Plans are created in the Partner Dashboard as "Basic" and "Advanced". */
export async function syncSubscription(admin: { graphql: Graphql }, shopId: string) {
  const res = await admin.graphql(QUERY);
  const json = (await res.json()) as { data?: { currentAppInstallation?: { activeSubscriptions?: ShopifySubscription[] } } };
  const { data, unrecognised } = pickSubscription(json.data?.currentAppInstallation?.activeSubscriptions ?? []);
  if (unrecognised) logger.warn("Subscription name did not match a known plan", { shopId });
  return prisma.subscription.upsert({ where: { shopId }, create: { shopId, ...data }, update: data });
}

export async function getEntitlements(shopId: string, now = new Date()) {
  const [row, shop] = await Promise.all([
    prisma.subscription.findUnique({ where: { shopId } }),
    prisma.shop.findUnique({ where: { id: shopId }, select: { installedAt: true } }),
  ]);
  const state: SubscriptionState | null = row
    ? { plan: (row.plan as SubscriptionState["plan"]) ?? null, status: row.status as SubscriptionStatus, trialEndsAt: row.trialEndsAt }
    : null;
  return resolveEntitlements(state, now, shop?.installedAt ?? null);
}

export function planSelectionUrl(shopDomain: string): string | null {
  if (!env.appHandle) return null;
  const store = shopDomain.replace(/\.myshopify\.com$/, "");
  return `https://admin.shopify.com/store/${store}/charges/${env.appHandle}/pricing_plans`;
}
