import prisma from "../db.server.ts";
import { hashEmail } from "../lib/tokens.ts";
import { planReviewRequests, type RequestSettings } from "../lib/request-scheduler.ts";
import { toOrderForRequests, type OrderWebhookPayload } from "../lib/orders.ts";

export type { OrderWebhookPayload };

export async function scheduleFromOrder(shopId: string, payload: OrderWebhookPayload, settings: RequestSettings) {
  const order = toOrderForRequests(payload);
  if (!order) return { created: 0, skipped: "invalid_order" as const };
  const suppressedHash = order.email
    ? await prisma.suppression.findUnique({ where: { shopId_emailHash: { shopId, emailHash: hashEmail(shopId, order.email) } } })
    : null;
  const plan = planReviewRequests(order, settings, () => Boolean(suppressedHash));
  if (!plan.requests.length) return { created: 0, skipped: plan.skipped };
  const res = await prisma.reviewRequest.createMany({
    data: plan.requests.map((r) => ({
      shopId, kind: "REQUEST", shopifyOrderId: r.orderId, shopifyProductId: r.productId, productTitle: r.productTitle,
      shopifyCustomerId: payload.customer?.id ? String(payload.customer.id) : null,
      recipientEmail: order.email, recipientName: payload.customer?.first_name?.slice(0, 60) ?? null, sendAt: r.sendAt,
    })),
    skipDuplicates: true, // webhook retries cannot create a second request for the same order and product
  });
  return { created: res.count, skipped: null };
}

export async function cancelRequestsForOrder(shopId: string, orderId: string) {
  const r = await prisma.reviewRequest.updateMany({ where: { shopId, shopifyOrderId: orderId, status: { in: ["QUEUED", "SENDING"] } }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  return r.count;
}

export async function suppressEmail(shopId: string, email: string, reason: string) {
  await prisma.suppression.upsert({
    where: { shopId_emailHash: { shopId, emailHash: hashEmail(shopId, email) } },
    create: { shopId, emailHash: hashEmail(shopId, email), reason }, update: {},
  });
  await prisma.reviewRequest.updateMany({ where: { shopId, recipientEmail: { equals: email, mode: "insensitive" }, status: { in: ["QUEUED", "SENDING"] } }, data: { status: "CANCELLED", cancelledAt: new Date() } });
}

export function listRequests(shopId: string, status: string | undefined, page: { skip: number; limit: number }) {
  const where = { shopId, ...(status ? { status: status as never } : {}) };
  return Promise.all([
    prisma.reviewRequest.findMany({ where, orderBy: { createdAt: "desc" }, skip: page.skip, take: page.limit, select: { id: true, kind: true, shopifyOrderId: true, productTitle: true, status: true, sendAt: true, sentAt: true, attempts: true, lastError: true, deliveryStatus: true } }),
    prisma.reviewRequest.count({ where }),
  ]);
}

/** Manual send: moves a queued request to "now". The worker applies all the normal checks before sending. */
export async function sendRequestNow(shopId: string, id: string) {
  const r = await prisma.reviewRequest.updateMany({ where: { id, shopId, status: "QUEUED" }, data: { sendAt: new Date() } });
  return r.count > 0;
}
