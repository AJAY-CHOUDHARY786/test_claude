import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server.ts";
import { authenticateProxy, json, readJsonBody } from "../services/proxy.server.ts";
import { questionLimiter } from "../services/limiters.server.ts";
import { sanitizeText } from "../lib/review-validation.ts";
import { clientIp } from "../lib/http.ts";
import { hasFeature } from "../lib/plans.ts";

// POST /apps/reviews/question (JSON). Questions are held for the merchant to answer and publish.
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const ctx = await authenticateProxy(request);
  if (!ctx) return json({ error: "unauthorized" }, 401);
  const { shop, ent } = ctx;
  if (!hasFeature(ent, "qa.manage")) return json({ error: "not_available" }, 403);
  if (!questionLimiter.check(`${shop.id}:${clientIp(request.headers)}`).allowed) return json({ error: "rate_limited" }, 429);
  const body = await readJsonBody(request, 5000);
  if (!body) return json({ error: "bad_request" }, 400);
  if (String(body.website ?? "").trim()) return json({ ok: true });
  const productId = String(body.productId ?? "");
  const text = sanitizeText(String(body.body ?? ""), 1000);
  const name = sanitizeText(String(body.name ?? ""), 60);
  if (!/^\d{1,20}$/.test(productId) || text.length < 3 || !name) return json({ ok: false, error: "Please enter your name and a question." }, 422);
  await prisma.question.create({ data: { shopId: shop.id, shopifyProductId: productId, body: text, askerName: name } });
  return json({ ok: true });
};
