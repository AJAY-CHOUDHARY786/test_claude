import prisma from "../db.server.ts";
import { logger } from "../config.server.ts";
import { getStorage } from "./storage.server.ts";
import { parsePrivacyPayload, privacyWhere } from "../lib/privacy-payload.ts";

/** Customer data request: collect what we hold for the merchant to download from the Help page. */
export async function handleDataRequest(domain: string, payload: unknown) {
  const shop = await prisma.shop.findUnique({ where: { domain } });
  if (!shop) return recordEvent(domain, "customers/data_request", "shop not found; nothing stored");
  const shopId = shop.id;
  const target = parsePrivacyPayload(payload, "orders_requested");
  const where = privacyWhere(shopId, target);
  if (!where) return recordEvent(domain, "customers/data_request", "no customer or order identifiers in the request");
  const requests = await prisma.reviewRequest.findMany({
    where,
    select: { shopifyOrderId: true, productTitle: true, recipientEmail: true, recipientName: true, status: true, sentAt: true, review: { select: { rating: true, title: true, body: true, reviewerName: true, createdAt: true } } },
  });
  // Stored on the merchant's audit log (deleted with the shop). The merchant downloads it from the Help page.
  await prisma.auditLog.create({ data: { shopId, actor: "shopify", action: "privacy.data_request", meta: { customerId: target.customerId, records: requests } as object } });
  return recordEvent(domain, "customers/data_request", `${requests.length} record(s) collected`);
}

/** Customer erasure: remove contact details and anonymise their reviews. */
export async function redactCustomer(domain: string, payload: unknown) {
  const shop = await prisma.shop.findUnique({ where: { domain } });
  if (!shop) return recordEvent(domain, "customers/redact", "shop not found; nothing stored");
  const shopId = shop.id;
  const where = privacyWhere(shopId, parsePrivacyPayload(payload, "orders_to_redact"));
  if (!where) return recordEvent(domain, "customers/redact", "no customer or order identifiers in the request");
  const ids = (await prisma.reviewRequest.findMany({ where, select: { id: true } })).map((a) => a.id);
  await prisma.$transaction([
    prisma.review.updateMany({ where: { shopId, requestId: { in: ids } }, data: { reviewerName: "Anonymous" } }),
    prisma.reviewRequest.updateMany({ where: { id: { in: ids }, shopId }, data: { recipientEmail: null, recipientName: null, shopifyCustomerId: null, status: "CANCELLED", cancelledAt: new Date() } }),
  ]);
  return recordEvent(domain, "customers/redact", `${ids.length} request(s) anonymised`);
}

export async function redactShop(domain: string) {
  const shop = await prisma.shop.findUnique({ where: { domain } });
  if (shop) {
    const media = await prisma.reviewMedia.findMany({ where: { shopId: shop.id }, select: { storageKey: true } });
    const storage = await getStorage();
    if (storage) for (const m of media) await storage.remove(m.storageKey).catch((e) => logger.warn("Photo cleanup failed", { error: e }));
    await prisma.shop.delete({ where: { id: shop.id } }); // cascades to every merchant-owned table
  }
  await prisma.session.deleteMany({ where: { shop: domain } });
  return recordEvent(domain, "shop/redact", shop ? "all shop data deleted" : "no data held");
}

async function recordEvent(shopDomain: string, kind: string, detail: string) {
  await prisma.privacyEvent.create({ data: { shopDomain, kind, detail, completedAt: new Date() } });
}
