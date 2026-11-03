import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server.ts";
import { authenticateProxy, json } from "../services/proxy.server.ts";
import { getStorage } from "../services/storage.server.ts";
import { readUploadToken } from "../services/links.server.ts";
import { bumpUsage } from "../services/reviews.server.ts";
import { uploadLimiter } from "../services/limiters.server.ts";
import { MAX_IMAGE_BYTES, MAX_IMAGES_PER_REVIEW, validateImageUpload } from "../lib/media.ts";
import { clientIp } from "../lib/http.ts";
import { hasFeature } from "../lib/plans.ts";

// POST /apps/reviews/upload  (multipart: token, file). The token only allows photos on the review just submitted.
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const ctx = await authenticateProxy(request);
  if (!ctx) return json({ error: "unauthorized" }, 401);
  const { shop, ent } = ctx;
  const storage = await getStorage();
  if (!storage || !shop.settings?.allowPhotos || !hasFeature(ent, "media.photos")) return json({ error: "not_available" }, 403);
  if (!uploadLimiter.check(`${shop.id}:${clientIp(request.headers)}`).allowed) return json({ error: "rate_limited" }, 429);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES + 100_000) return json({ error: "too_large" }, 413);

  const form = await request.formData();
  const grant = readUploadToken(String(form.get("token") ?? ""));
  const file = form.get("file");
  if (!grant || grant.shopId !== shop.id || !(file instanceof File)) return json({ error: "bad_request" }, 400);
  if (file.size > MAX_IMAGE_BYTES) return json({ error: "too_large" }, 413);

  const review = await prisma.review.findFirst({ where: { id: grant.reviewId, shopId: shop.id, deletedAt: null }, include: { _count: { select: { media: true } } } });
  if (!review) return json({ error: "not_found" }, 404);
  if (review._count.media >= MAX_IMAGES_PER_REVIEW) return json({ error: "too_many", message: `You can add up to ${MAX_IMAGES_PER_REVIEW} photos.` }, 422);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateImageUpload(bytes, shop.id, file.type);
  if (!check.ok) return json({ error: "invalid_file", message: check.error }, 422);
  await storage.put(check.storageKey, bytes, check.image.mime);
  try {
    await prisma.reviewMedia.create({ data: { shopId: shop.id, reviewId: review.id, storageKey: check.storageKey, mime: check.image.mime, sizeBytes: bytes.byteLength } });
    await bumpUsage(prisma, shop.id, { photosStored: 1 });
  } catch (e) {
    await storage.remove(check.storageKey).catch(() => undefined); // never leave an orphaned file
    throw e;
  }
  return json({ ok: true });
};
