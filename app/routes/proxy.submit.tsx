import type { ActionFunctionArgs } from "react-router";
import { authenticateProxy, json, readJsonBody } from "../services/proxy.server.ts";
import { createReview } from "../services/reviews.server.ts";
import { getStorage } from "../services/storage.server.ts";
import { uploadToken } from "../services/links.server.ts";
import { submitLimiter } from "../services/limiters.server.ts";
import { validateReviewSubmission } from "../lib/review-validation.ts";
import { clientIp } from "../lib/http.ts";
import { hasFeature } from "../lib/plans.ts";
import { customerBoughtProduct } from "../services/purchase.server.ts";

// POST /apps/reviews/submit  (JSON). Verified status is decided here on the server, never taken from the request body.
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const ctx = await authenticateProxy(request);
  if (!ctx) return json({ error: "unauthorized" }, 401);
  const { shop, ent, url } = ctx;
  if (!hasFeature(ent, "storefront.collect")) return json({ error: "not_available" }, 403);
  if (!submitLimiter.check(`${shop.id}:${clientIp(request.headers)}`).allowed) return json({ error: "rate_limited", message: "Too many reviews from this connection. Please try again later." }, 429);

  const body = await readJsonBody(request);
  if (!body) return json({ error: "bad_request" }, 400);
  const result = validateReviewSubmission(body);
  if (!result.ok) {
    if (result.bot) return json({ ok: true, status: "PENDING" }); // pretend success so bots learn nothing; nothing is stored
    return json({ ok: false, errors: result.errors }, 422);
  }
  // Verified only if Shopify (via the signed logged_in_customer_id) confirms a paid order for this product.
  const customerId = url.searchParams.get("logged_in_customer_id");
  const verified = customerId ? await customerBoughtProduct(shop.domain, customerId, result.value.productId) : false;
  const review = await createReview(shop.id, result.value, { verified, autoPublish: shop.settings?.autoPublish ?? false });
  if (review === "duplicate") return json({ error: "duplicate" }, 409);
  const canUpload = Boolean(shop.settings?.allowPhotos) && hasFeature(ent, "media.photos") && Boolean(await getStorage());
  return json({ ok: true, status: review.status, uploadToken: canUpload ? uploadToken(review.id, shop.id) : null });
};
