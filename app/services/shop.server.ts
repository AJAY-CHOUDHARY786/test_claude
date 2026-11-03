import { data } from "react-router";
import prisma from "../db.server.ts";
import { authenticate } from "../shopify.server.ts";
import { getEntitlements } from "./billing.server.ts";
import { assertFeature, type Entitlements, type Feature, FeatureDeniedError } from "../lib/plans.ts";

/** Creates the Shop row (and default settings) the first time a store opens the app, and clears any uninstall mark. */
export async function ensureShop(domain: string) {
  return prisma.shop.upsert({
    where: { domain },
    create: { domain, settings: { create: {} } },
    update: { uninstalledAt: null },
    include: { settings: true },
  });
}

export async function getSettings(shopId: string) {
  return prisma.shopSettings.upsert({ where: { shopId }, create: { shopId }, update: {} });
}

/** Authenticates the merchant and resolves their shop and plan. Every admin loader and action starts here. */
export async function requireMerchant(request: Request) {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const ent = await getEntitlements(shop.id);
  return { admin, session, shop, ent, actor: `merchant:${session.shop}` };
}

/** For actions: enforces a feature on the server. Returns a 403 JSON response instead of throwing past the UI. */
export function denyIfLacking(ent: Entitlements, feature: Feature) {
  try {
    assertFeature(ent, feature);
    return null;
  } catch (e) {
    if (e instanceof FeatureDeniedError) {
      return data({ ok: false, error: "Your current plan does not include this feature. Upgrade on the Billing page." }, { status: 403 });
    }
    throw e;
  }
}

export async function writeAudit(shopId: string, actor: string, action: string, target?: string, meta?: object) {
  await prisma.auditLog.create({ data: { shopId, actor, action, target: target ?? null, meta: meta ?? undefined } });
}

export async function markUninstalled(domain: string) {
  const shop = await prisma.shop.findUnique({ where: { domain } });
  await prisma.session.deleteMany({ where: { shop: domain } });
  if (!shop) return;
  await prisma.$transaction([
    prisma.shop.update({ where: { id: shop.id }, data: { uninstalledAt: new Date() } }),
    prisma.reviewRequest.updateMany({ where: { shopId: shop.id, status: { in: ["QUEUED", "SENDING"] } }, data: { status: "CANCELLED", cancelledAt: new Date() } }),
    prisma.subscription.updateMany({ where: { shopId: shop.id }, data: { status: "CANCELLED" } }),
  ]);
}

export async function shopByDomainActive(domain: string) {
  const shop = await prisma.shop.findUnique({ where: { domain }, include: { settings: true } });
  return shop && !shop.uninstalledAt ? shop : null;
}

/** Looks up product titles for display. Returns an empty map on failure; the UI falls back to the product ID. */
export async function getProductTitles(admin: { graphql: (q: string, o?: { variables: object }) => Promise<Response> }, ids: string[]) {
  const titles = new Map<string, string>();
  const unique = [...new Set(ids)].slice(0, 100);
  if (!unique.length) return titles;
  try {
    const res = await admin.graphql(`#graphql
      query ProductTitles($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id title } } }`,
      { variables: { ids: unique.map((i) => `gid://shopify/Product/${i}`) } });
    const json = (await res.json()) as { data?: { nodes?: ({ id: string; title: string } | null)[] } };
    for (const n of json.data?.nodes ?? []) if (n) titles.set(n.id.split("/").pop()!, n.title);
  } catch {
    /* titles are cosmetic */
  }
  return titles;
}
