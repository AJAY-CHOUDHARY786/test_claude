import type { ActionFunctionArgs } from "react-router";
import { handleWebhook } from "../services/webhooks.server.ts";
import { shopByDomainActive } from "../services/shop.server.ts";
import { getEntitlements } from "../services/billing.server.ts";
import { scheduleFromOrder, type OrderWebhookPayload } from "../services/requests.server.ts";
import { hasFeature } from "../lib/plans.ts";

export const action = ({ request }: ActionFunctionArgs) =>
  handleWebhook(request, async ({ shop: domain, payload }) => {
    const shop = await shopByDomainActive(domain);
    if (!shop?.settings) return;
    const ent = await getEntitlements(shop.id);
    if (!hasFeature(ent, "requests.basic")) return; // no active plan: nothing is scheduled
    const s = shop.settings;
    await scheduleFromOrder(shop.id, payload as OrderWebhookPayload, {
      enabled: s.requestsEnabled, delayDays: s.requestDelayDays, maxProductsPerOrder: s.maxProductsPerOrder, excludedProductIds: s.excludedProductIds,
    });
  });
