import type { ActionFunctionArgs } from "react-router";
import { handleWebhook } from "../services/webhooks.server.ts";
import prisma from "../db.server.ts";
import { cancelRequestsForOrder } from "../services/requests.server.ts";

export const action = ({ request }: ActionFunctionArgs) =>
  handleWebhook(request, async ({ shop: domain, payload }) => {
    const shop = await prisma.shop.findUnique({ where: { domain } });
    const id = (payload as { id?: number | string }).id;
    if (shop && id !== undefined) await cancelRequestsForOrder(shop.id, String(id));
  });
