/** Webhook processing rules, independent of Shopify and the database so they can be tested. */
export const normalizeTopic = (t: string) => t.toUpperCase().replace(/[/.]/g, "_");

export interface WebhookStore {
  /** Returns false if this webhook ID was already seen (a duplicate delivery). */
  claim(id: string, shop: string, topic: string): Promise<boolean>;
  markProcessed(id: string): Promise<void>;
  release(id: string): Promise<void>;
}
export interface WebhookLog { info(msg: string, f?: Record<string, unknown>): void; warn(msg: string, f?: Record<string, unknown>): void; error(msg: string, f?: Record<string, unknown>): void }

/**
 * 200 = done or duplicate (Shopify stops retrying). 500 = failed (Shopify retries later).
 * A failed handler releases its claim so the retry runs again; handlers must therefore be idempotent.
 */
export async function processWebhook(o: { id: string | null; shop: string; topic: string; handler: () => Promise<void>; store: WebhookStore; log: WebhookLog }): Promise<200 | 500> {
  const { id, shop, topic, handler, store, log } = o;
  if (id) {
    try {
      if (!(await store.claim(id, shop, topic))) { log.info("Duplicate webhook ignored", { shop, topic }); return 200; }
    } catch (e) {
      log.error("Could not record webhook; asking Shopify to retry", { shop, topic, error: e });
      return 500;
    }
  }
  try {
    await handler();
  } catch (e) {
    if (id) await store.release(id).catch(() => undefined);
    log.error("Webhook handler failed", { shop, topic, error: e });
    return 500;
  }
  if (id) await store.markProcessed(id).catch((e) => log.warn("Could not mark webhook processed", { shop, topic, error: e }));
  return 200;
}
