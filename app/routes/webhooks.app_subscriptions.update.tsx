import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server.ts";
import { handleWebhook } from "../services/webhooks.server.ts";
import { syncSubscription } from "../services/billing.server.ts";
import { unauthenticated } from "../shopify.server.ts";

// Plan changes, cancellations and billing failures arrive here; the truth is always re-read from Shopify.
export const action = ({ request }: ActionFunctionArgs) =>
  handleWebhook(request, async ({ shop: domain }) => {
    const shop = await prisma.shop.findUnique({ where: { domain } });
    if (!shop || shop.uninstalledAt) return;
    const { admin } = await unauthenticated.admin(domain);
    await syncSubscription(admin, shop.id);
  });
