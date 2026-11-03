import { Prisma } from "@prisma/client";
import prisma from "../db.server.ts";
import { authenticate } from "../shopify.server.ts";
import { logger } from "../config.server.ts";
import { normalizeTopic, processWebhook, type WebhookStore } from "../lib/webhook-core.ts";

export { normalizeTopic };

/** Remembers webhook IDs in PostgreSQL so duplicate deliveries are ignored. */
export const prismaWebhookStore: WebhookStore = {
  async claim(id, shop, topic) {
    try {
      await prisma.webhookEvent.create({ data: { id, shopDomain: shop, topic: topic.slice(0, 60) } });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
      throw e;
    }
  },
  async markProcessed(id) { await prisma.webhookEvent.update({ where: { id }, data: { processedAt: new Date() } }); },
  async release(id) { await prisma.webhookEvent.delete({ where: { id } }); },
};

/** Verifies the Shopify signature (authenticate.webhook rejects invalid ones), then applies the tested duplicate/retry rules. */
export async function handleWebhook(request: Request, handler: (ctx: { shop: string; topic: string; payload: unknown }) => Promise<void>) {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const id = request.headers.get("x-shopify-webhook-id") ?? request.headers.get("x-shopify-event-id");
  const status = await processWebhook({ id, shop, topic, store: prismaWebhookStore, log: logger.child({ shop, topic }), handler: () => handler({ shop, topic: normalizeTopic(topic), payload }) });
  return new Response(null, { status });
}
