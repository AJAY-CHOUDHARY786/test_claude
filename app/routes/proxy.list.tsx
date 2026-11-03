import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server.ts";
import { authenticateProxy, json } from "../services/proxy.server.ts";
import { publicReviews } from "../services/reviews.server.ts";
import { getStorage } from "../services/storage.server.ts";
import { listLimiter } from "../services/limiters.server.ts";
import { productTitle } from "../services/products.server.ts";
import { clientIp } from "../lib/http.ts";
import { hasFeature } from "../lib/plans.ts";
import { parseListParams } from "../lib/proxy-params.ts";
import { buildProductJsonLd } from "../lib/structured-data.ts";

// GET /apps/reviews/list?product_id=123&page=1&sort=newest&rating=5[&summary=1]
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await authenticateProxy(request);
  if (!ctx) return json({ error: "unauthorized" }, 401);
  const { url, shop, ent } = ctx;
  if (!listLimiter.check(`${shop.id}:${clientIp(request.headers)}`).allowed) return json({ error: "rate_limited" }, 429);
  const params = parseListParams(url.searchParams, shop.settings?.reviewsPerPage ?? 10);
  if (!params) return json({ error: "bad_product" }, 400);
  const productId = params.productId;

  const s = shop.settings;
  const override = await prisma.productWidgetSetting.findUnique({ where: { shopId_shopifyProductId: { shopId: shop.id, shopifyProductId: productId } } });
  const custom = hasFeature(ent, "widgets.customize");
  const settings = {
    accent: custom ? (override?.accentColor ?? s?.widgetAccentColor ?? "#1f4b3f") : "#1f4b3f",
    layout: custom ? (override?.layout ?? s?.widgetLayout ?? "list") : "list",
    showVerified: s?.showVerifiedBadge ?? true,
    perPage: s?.reviewsPerPage ?? 10,
    canSubmit: hasFeature(ent, "storefront.collect"),
    canAsk: hasFeature(ent, "qa.manage"),
    advancedDisplay: hasFeature(ent, "display.advanced"),
    allowPhotos: Boolean(s?.allowPhotos) && hasFeature(ent, "media.photos") && Boolean(await getStorage()),
  };
  if (!hasFeature(ent, "storefront.display")) return json({ disabled: true, settings });
  if (custom && override?.hidden) return json({ disabled: true, settings }); // merchant hid the widget for this product

  const display = hasFeature(ent, "display.advanced") ? { sort: params.sort, rating: params.rating } : { sort: "newest" as const, rating: undefined };

  const data = await publicReviews(shop.id, productId, { page: params.page, limit: params.limit, ...display });
  const headers = { "Cache-Control": "public, max-age=60" };
  if (params.summaryOnly) return json({ summary: data.summary, settings }, 200, headers);

  const storage = await getStorage();
  const reviews = data.items.map((r) => ({
    id: r.id, rating: r.rating, title: r.title, body: r.body, name: r.reviewerName,
    verified: r.verifiedPurchase && settings.showVerified, date: (r.publishedAt ?? r.createdAt).toISOString().slice(0, 10),
    reply: r.reply ? { body: r.reply.body } : null, photos: storage ? r.media.map((m) => storage.publicUrl(m.storageKey)) : [],
  }));
  const questions = hasFeature(ent, "qa.manage")
    ? (await prisma.question.findMany({ where: { shopId: shop.id, shopifyProductId: productId, status: "PUBLISHED", answer: { isNot: null } }, include: { answer: true }, orderBy: { createdAt: "desc" }, take: 10 })).map((q) => ({ question: q.body, asker: q.askerName, answer: q.answer?.body ?? "" }))
    : [];

  let jsonLd: string | null = null;
  if (s?.emitStructuredData && data.summary.total > 0 && data.summary.average) {
    const title = await productTitle(shop.domain, productId);
    if (title) jsonLd = buildProductJsonLd({ productName: title, reviewCount: data.summary.total, averageRating: data.summary.average, reviews: data.items.map((r) => ({ author: r.reviewerName, rating: r.rating, body: r.body, datePublished: r.publishedAt ?? r.createdAt })) });
  }
  return json({ summary: data.summary, reviews, page: params.page, hasMore: params.skip + reviews.length < data.total, settings, questions, jsonLd }, 200, headers);
};
