import type { ActionFunctionArgs } from "react-router";
import { handleWebhook } from "../services/webhooks.server.ts";
import { handleDataRequest, redactCustomer, redactShop } from "../services/privacy.server.ts";

// Mandatory privacy webhooks: customers/data_request, customers/redact, shop/redact.
export const action = ({ request }: ActionFunctionArgs) =>
  handleWebhook(request, async ({ shop, topic, payload }) => {
    switch (topic) {
      case "CUSTOMERS_DATA_REQUEST": return handleDataRequest(shop, payload as never);
      case "CUSTOMERS_REDACT": return redactCustomer(shop, payload as never);
      case "SHOP_REDACT": return redactShop(shop);
      default: throw new Error(`Unexpected compliance topic: ${topic}`);
    }
  });
