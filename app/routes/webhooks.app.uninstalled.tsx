import type { ActionFunctionArgs } from "react-router";
import { handleWebhook } from "../services/webhooks.server.ts";
import { markUninstalled } from "../services/shop.server.ts";

export const action = ({ request }: ActionFunctionArgs) =>
  handleWebhook(request, async ({ shop }) => { await markUninstalled(shop); });
