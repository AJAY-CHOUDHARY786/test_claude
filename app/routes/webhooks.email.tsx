import type { ActionFunctionArgs } from "react-router";
import { env, logger } from "../config.server.ts";
import { verifySvixSignature } from "../lib/svix.ts";
import { applyEmailEvent } from "../services/email-events.server.ts";
import { prismaWebhookStore } from "../services/webhooks.server.ts";
import { processWebhook } from "../lib/webhook-core.ts";

// Delivery, bounce and complaint events from the email provider. Not a Shopify webhook, so it has its own signature check.
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const secret = env.email.webhookSecret;
  if (!secret) return new Response(null, { status: 503 });
  const body = await request.text();
  if (body.length > 100_000) return new Response(null, { status: 413 });
  const id = request.headers.get("svix-id") ?? "";
  const valid = verifySvixSignature({ secret, id, timestamp: request.headers.get("svix-timestamp") ?? "", body, signatureHeader: request.headers.get("svix-signature") ?? "", now: new Date() });
  if (!valid) return new Response(null, { status: 401 });

  let event: { type?: string; data?: { email_id?: string } };
  try { event = JSON.parse(body); } catch { return new Response(null, { status: 400 }); }
  const status = await processWebhook({
    id: `email:${id}`, shop: "email", topic: String(event.type ?? "unknown"), store: prismaWebhookStore, log: logger,
    handler: () => applyEmailEvent(String(event.type ?? ""), event.data?.email_id),
  });
  return new Response(null, { status });
};
