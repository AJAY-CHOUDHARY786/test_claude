import { Prisma, type ReviewStatus } from "@prisma/client";
import prisma from "../db.server.ts";
import { sanitizeText, type ReviewSubmission } from "../lib/review-validation.ts";
import { summarizeRatings, bucketByWeek, type RatingCounts } from "../lib/analytics.ts";
import { EXPORT_HEADER, type ImportRow } from "../lib/csv.ts";

// Tenant rule: every function takes shopId and puts it in every query's where clause.

export interface ReviewFilters {
  status?: ReviewStatus; rating?: number; productId?: string; q?: string;
  verified?: boolean; hasMedia?: boolean; from?: Date; to?: Date;
  sort?: "newest" | "oldest" | "highest" | "lowest";
}

const ORDER = {
  newest: [{ createdAt: "desc" }], oldest: [{ createdAt: "asc" }],
  highest: [{ rating: "desc" }, { createdAt: "desc" }], lowest: [{ rating: "asc" }, { createdAt: "desc" }],
} as const;

function whereFor(shopId: string, f: ReviewFilters): Prisma.ReviewWhereInput {
  const w: Prisma.ReviewWhereInput = { shopId, deletedAt: null };
  if (f.status) w.status = f.status;
  if (f.rating) w.rating = f.rating;
  if (f.productId) w.shopifyProductId = f.productId;
  if (f.verified !== undefined) w.verifiedPurchase = f.verified;
  if (f.hasMedia) w.media = { some: {} };
  if (f.q) w.OR = [{ body: { contains: f.q, mode: "insensitive" } }, { title: { contains: f.q, mode: "insensitive" } }, { reviewerName: { contains: f.q, mode: "insensitive" } }];
  if (f.from || f.to) w.createdAt = { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) };
  return w;
}

export async function listReviews(shopId: string, f: ReviewFilters, page: { skip: number; limit: number }) {
  const where = whereFor(shopId, f);
  const [items, total] = await Promise.all([
    prisma.review.findMany({ where, orderBy: [...ORDER[f.sort ?? "newest"]], skip: page.skip, take: page.limit, include: { reply: true, _count: { select: { media: true } } } }),
    prisma.review.count({ where }),
  ]);
  return { items, total };
}

export function getReview(shopId: string, id: string) {
  return prisma.review.findFirst({
    where: { id, shopId, deletedAt: null },
    include: { reply: true, media: true, events: { orderBy: { createdAt: "desc" }, take: 50 } },
  });
}

function utcDay(d = new Date()) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }

export async function bumpUsage(tx: Prisma.TransactionClient | typeof prisma, shopId: string, inc: { reviewsCreated?: number; requestsSent?: number; photosStored?: number }) {
  const day = utcDay();
  await tx.usageStat.upsert({
    where: { shopId_day: { shopId, day } },
    create: { shopId, day, reviewsCreated: inc.reviewsCreated ?? 0, requestsSent: inc.requestsSent ?? 0, photosStored: inc.photosStored ?? 0 },
    update: {
      ...(inc.reviewsCreated ? { reviewsCreated: { increment: inc.reviewsCreated } } : {}),
      ...(inc.requestsSent ? { requestsSent: { increment: inc.requestsSent } } : {}),
      ...(inc.photosStored ? { photosStored: { increment: inc.photosStored } } : {}),
    },
  });
}

/** verified is decided by the server only (a valid review-request link), never by the submitter. */
export async function createReview(shopId: string, input: ReviewSubmission, opts: { verified: boolean; requestId?: string | null; autoPublish: boolean; source?: string }) {
  const status: ReviewStatus = opts.autoPublish ? "PUBLISHED" : "PENDING";
  try {
    return await prisma.$transaction(async (tx) => {
      // A review may only be linked to a request that belongs to the same shop.
      if (opts.requestId) {
        const owned = await tx.reviewRequest.findFirst({ where: { id: opts.requestId, shopId }, select: { id: true } });
        if (!owned) throw new Error("Review request does not belong to this shop");
      }
      const review = await tx.review.create({
        data: {
          shopId, shopifyProductId: input.productId, rating: input.rating, title: input.title, body: input.body,
          reviewerName: input.reviewerName, status, verifiedPurchase: opts.verified, source: opts.source ?? "STOREFRONT",
          requestId: opts.requestId ?? null, publishedAt: status === "PUBLISHED" ? new Date() : null,
        },
      });
      await tx.moderationEvent.create({ data: { shopId, reviewId: review.id, action: "created", toStatus: status, actor: opts.verified ? "customer:verified" : "customer" } });
      if (opts.requestId) {
        const req = await tx.reviewRequest.findFirst({ where: { id: opts.requestId, shopId } });
        if (req) {
          await tx.reviewRequest.updateMany({ where: { id: req.id, shopId }, data: { status: "COMPLETED" } });
          await tx.reviewRequest.updateMany({
            where: { shopId, shopifyOrderId: req.shopifyOrderId, shopifyProductId: req.shopifyProductId, status: "QUEUED" },
            data: { status: "CANCELLED", cancelledAt: new Date() },
          });
        }
      }
      await bumpUsage(tx, shopId, { reviewsCreated: 1 });
      return review;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "duplicate" as const;
    throw e;
  }
}

export const MODERATION_ACTIONS = { approve: "PUBLISHED", reject: "REJECTED", hide: "HIDDEN", restore: "PUBLISHED", unpublish: "PENDING" } as const;
export type ModerationAction = keyof typeof MODERATION_ACTIONS;
export const isModerationAction = (a: string): a is ModerationAction => a in MODERATION_ACTIONS;

export async function moderateReview(shopId: string, id: string, action: ModerationAction, actor: string, note?: string) {
  const toStatus = MODERATION_ACTIONS[action];
  return prisma.$transaction(async (tx) => {
    const review = await tx.review.findFirst({ where: { id, shopId, deletedAt: null }, select: { id: true, status: true } });
    if (!review) return null;
    if (review.status !== toStatus) {
      await tx.review.updateMany({ where: { id, shopId }, data: { status: toStatus, ...(toStatus === "PUBLISHED" ? { publishedAt: new Date() } : {}) } });
      await tx.moderationEvent.create({ data: { shopId, reviewId: id, action, fromStatus: review.status, toStatus, actor, note: note ? sanitizeText(note, 500) : null } });
    }
    return { id, status: toStatus };
  });
}

export async function bulkModerate(shopId: string, ids: string[], action: ModerationAction, actor: string) {
  const unique = [...new Set(ids)].slice(0, 100);
  const toStatus = MODERATION_ACTIONS[action];
  return prisma.$transaction(async (tx) => {
    const found = await tx.review.findMany({ where: { id: { in: unique }, shopId, deletedAt: null, NOT: { status: toStatus } }, select: { id: true, status: true } });
    if (!found.length) return 0;
    await tx.review.updateMany({ where: { id: { in: found.map((f) => f.id) }, shopId }, data: { status: toStatus, ...(toStatus === "PUBLISHED" ? { publishedAt: new Date() } : {}) } });
    await tx.moderationEvent.createMany({ data: found.map((f) => ({ shopId, reviewId: f.id, action: `bulk_${action}`, fromStatus: f.status, toStatus, actor })) });
    return found.length;
  });
}

export async function editReview(shopId: string, id: string, edit: { title: string | null; body: string; reviewerName: string }, actor: string) {
  const body = sanitizeText(edit.body, 5000);
  const reviewerName = sanitizeText(edit.reviewerName, 60);
  if (body.length < 1 || !reviewerName) return null;
  return prisma.$transaction(async (tx) => {
    const n = await tx.review.updateMany({ where: { id, shopId, deletedAt: null }, data: { title: edit.title ? sanitizeText(edit.title, 120) : null, body, reviewerName } });
    if (!n.count) return null;
    await tx.moderationEvent.create({ data: { shopId, reviewId: id, action: "edited", actor } });
    return true;
  });
}

/** Soft delete. The purge job removes the row and its photos after the retention period. */
export async function softDeleteReview(shopId: string, id: string, actor: string) {
  return prisma.$transaction(async (tx) => {
    const n = await tx.review.updateMany({ where: { id, shopId, deletedAt: null }, data: { deletedAt: new Date(), status: "HIDDEN" } });
    if (!n.count) return false;
    await tx.moderationEvent.create({ data: { shopId, reviewId: id, action: "deleted", actor } });
    return true;
  });
}

export async function replyToReview(shopId: string, id: string, text: string, actor: string) {
  const body = sanitizeText(text, 2000);
  if (!body) return null;
  return prisma.$transaction(async (tx) => {
    const review = await tx.review.findFirst({ where: { id, shopId, deletedAt: null }, select: { id: true } });
    if (!review) return null;
    const updated = await tx.reviewReply.updateMany({ where: { reviewId: id, shopId }, data: { body } });
    if (!updated.count) await tx.reviewReply.create({ data: { shopId, reviewId: id, body } });
    await tx.moderationEvent.create({ data: { shopId, reviewId: id, action: "replied", actor } });
    return true;
  });
}

export async function deleteReply(shopId: string, id: string, actor: string) {
  const n = await prisma.reviewReply.deleteMany({ where: { reviewId: id, shopId } });
  if (n.count) await prisma.moderationEvent.create({ data: { shopId, reviewId: id, action: "reply_deleted", actor } });
  return n.count > 0;
}

export async function ratingCounts(shopId: string, productId?: string): Promise<Partial<RatingCounts>> {
  const rows = await prisma.review.groupBy({ by: ["rating"], where: { shopId, status: "PUBLISHED", deletedAt: null, ...(productId ? { shopifyProductId: productId } : {}) }, _count: { _all: true } });
  const out: Partial<RatingCounts> = {};
  for (const r of rows) if (r.rating >= 1 && r.rating <= 5) out[r.rating as 1 | 2 | 3 | 4 | 5] = r._count._all;
  return out;
}

export async function dashboardStats(shopId: string) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [counts, pending, requests, last30] = await Promise.all([
    ratingCounts(shopId),
    prisma.review.count({ where: { shopId, status: "PENDING", deletedAt: null } }),
    prisma.reviewRequest.groupBy({ by: ["status"], where: { shopId }, _count: { _all: true } }),
    prisma.review.count({ where: { shopId, deletedAt: null, createdAt: { gte: since } } }),
  ]);
  return { ratings: summarizeRatings(counts), pending, last30, requests: Object.fromEntries(requests.map((r) => [r.status, r._count._all])) as Record<string, number> };
}

export async function advancedAnalytics(shopId: string, now = new Date()) {
  const since = new Date(now.getTime() - 12 * 7 * 86_400_000);
  const [dates, top, verified, total] = await Promise.all([
    prisma.review.findMany({ where: { shopId, deletedAt: null, createdAt: { gte: since } }, select: { createdAt: true }, take: 50_000 }),
    prisma.review.groupBy({ by: ["shopifyProductId"], where: { shopId, status: "PUBLISHED", deletedAt: null }, _count: { _all: true }, _avg: { rating: true }, orderBy: { _count: { shopifyProductId: "desc" } }, take: 10 }),
    prisma.review.count({ where: { shopId, deletedAt: null, verifiedPurchase: true } }),
    prisma.review.count({ where: { shopId, deletedAt: null } }),
  ]);
  return { weekly: bucketByWeek(dates.map((d) => d.createdAt), 12, now), top: top.map((t) => ({ productId: t.shopifyProductId, count: t._count._all, average: t._avg.rating ? Math.round(t._avg.rating * 100) / 100 : null })), verifiedShare: total ? Math.round((verified / total) * 100) : null, total };
}

export async function exportRows(shopId: string, limit = 20_000) {
  const reviews = await prisma.review.findMany({ where: { shopId, deletedAt: null }, orderBy: { createdAt: "asc" }, take: limit, include: { reply: true } });
  return [EXPORT_HEADER, ...reviews.map((r) => [r.id, r.shopifyProductId, r.rating, r.title ?? "", r.body, r.reviewerName, r.status.toLowerCase(), r.verifiedPurchase, r.createdAt.toISOString(), r.reply?.body ?? ""])];
}

export async function insertImportedBatch(shopId: string, rows: ImportRow[]) {
  const res = await prisma.review.createMany({
    data: rows.map((r) => ({
      shopId, shopifyProductId: r.productId, rating: r.rating, title: r.title, body: r.body, reviewerName: r.reviewerName, status: r.status,
      publishedAt: r.status === "PUBLISHED" ? (r.createdAt ?? new Date()) : null, createdAt: r.createdAt ?? undefined, source: "IMPORT", externalKey: r.externalKey,
    })),
    skipDuplicates: true, // existing rows with the same externalKey are left untouched
  });
  const withReply = rows.filter((r) => r.reply);
  if (withReply.length) {
    const byKey = new Map(withReply.map((r) => [r.externalKey, r.reply!]));
    const found = await prisma.review.findMany({ where: { shopId, externalKey: { in: [...byKey.keys()] } }, select: { id: true, externalKey: true } });
    await prisma.reviewReply.createMany({ data: found.map((f) => ({ shopId, reviewId: f.id, body: byKey.get(f.externalKey!)! })), skipDuplicates: true });
  }
  return res.count;
}

/** Only fields that are safe to show to shoppers. No emails, no internal IDs beyond the review id. */
export async function publicReviews(shopId: string, productId: string, opts: { page: number; limit: number; sort: "newest" | "highest" | "lowest"; rating?: number }) {
  const where: Prisma.ReviewWhereInput = { shopId, shopifyProductId: productId, status: "PUBLISHED", deletedAt: null, ...(opts.rating ? { rating: opts.rating } : {}) };
  const [items, total, counts] = await Promise.all([
    prisma.review.findMany({ where, orderBy: [...ORDER[opts.sort]], skip: (opts.page - 1) * opts.limit, take: opts.limit, include: { reply: { select: { body: true, createdAt: true } }, media: { select: { storageKey: true } } } }),
    prisma.review.count({ where }),
    ratingCounts(shopId, productId),
  ]);
  return { items, total, summary: summarizeRatings(counts) };
}
