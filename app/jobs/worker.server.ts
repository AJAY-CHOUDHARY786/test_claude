import { Prisma } from "@prisma/client";
import prisma from "../db.server.ts";
import { env, logger } from "../config.server.ts";
import { createEmailProvider, type EmailProvider } from "../services/email.server.ts";
import { getEntitlements } from "../services/billing.server.ts";
import { reviewLink, unsubscribeLink } from "../services/links.server.ts";
import { bumpUsage, insertImportedBatch } from "../services/reviews.server.ts";
import { getStorage } from "../services/storage.server.ts";
import { DEFAULT_TEMPLATES, ensureUnsubscribe, renderHtml, renderText } from "../lib/email-template.ts";
import { decideSend, nextRetryAt } from "../lib/request-scheduler.ts";
import { hashEmail } from "../lib/tokens.ts";
import { hasFeature } from "../lib/plans.ts";
import type { ImportRow } from "../lib/csv.ts";

const claimRequests = (limit: number) =>
  prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    UPDATE "ReviewRequest" SET "status" = 'SENDING', "attempts" = "attempts" + 1, "updatedAt" = now()
    WHERE "id" IN (
      SELECT "id" FROM "ReviewRequest"
      WHERE "status" = 'QUEUED' AND "sendAt" <= now() AND "cancelledAt" IS NULL
      ORDER BY "sendAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING "id"`);

const safeName = (s: string) => s.replace(/["<>\r\n]/g, "").slice(0, 60);

async function processRequest(id: string, provider: EmailProvider, now: Date) {
  const req = await prisma.reviewRequest.findUnique({ where: { id }, include: { shop: { include: { settings: true } } } });
  if (!req) return;
  const finish = (status: "CANCELLED" | "SKIPPED", why: string) =>
    prisma.reviewRequest.update({ where: { id }, data: { status, lastError: why, ...(status === "CANCELLED" ? { cancelledAt: now } : {}) } });

  if (req.shop.uninstalledAt || !req.recipientEmail) return void (await finish("CANCELLED", "shop uninstalled or recipient removed"));
  const [ent, suppression, alreadyReviewed] = await Promise.all([
    getEntitlements(req.shopId, now),
    prisma.suppression.findUnique({ where: { shopId_emailHash: { shopId: req.shopId, emailHash: hashEmail(req.shopId, req.recipientEmail) } } }),
    prisma.reviewRequest.count({ where: { shopId: req.shopId, shopifyOrderId: req.shopifyOrderId, shopifyProductId: req.shopifyProductId, status: "COMPLETED" } }),
  ]);
  if (alreadyReviewed) return void (await finish("CANCELLED", "review already submitted"));
  const entitled = hasFeature(ent, req.kind === "REMINDER" ? "requests.advanced" : "requests.basic");
  const decision = decideSend({ status: "QUEUED", cancelledAt: req.cancelledAt, sendAt: req.sendAt }, { suppressed: Boolean(suppression), entitled, now });
  if (decision === "suppressed") return void (await finish("CANCELLED", "recipient unsubscribed"));
  if (decision === "not_entitled") return void (await finish("SKIPPED", "plan does not include this request type"));
  if (decision !== "send") return void (await finish("SKIPPED", decision));

  const kind = req.kind === "REMINDER" ? "REMINDER" : "REQUEST";
  const custom = hasFeature(ent, "requests.advanced") ? await prisma.emailTemplate.findUnique({ where: { shopId_kind: { shopId: req.shopId, kind } } }) : null;
  const tpl = custom ?? DEFAULT_TEMPLATES[kind];
  const body = ensureUnsubscribe(tpl.body);
  const unsub = unsubscribeLink(req.shopId, req.recipientEmail);
  const vars = { customer_name: req.recipientName ?? "there", product_title: req.productTitle, shop_name: req.shop.domain.replace(/\.myshopify\.com$/, ""), review_link: reviewLink(req.id), unsubscribe_link: unsub };
  const settings = req.shop.settings;
  const from = env.email.from ? `"${safeName(settings?.senderName ?? vars.shop_name)}" <${env.email.from.replace(/^.*<|>$/g, "")}>` : "noreply@invalid.example";

  try {
    const sent = await provider.send({ to: req.recipientEmail, from, replyTo: settings?.replyToEmail ?? undefined, subject: renderText(tpl.subject, vars), text: renderText(body, vars), html: renderHtml(body, vars), unsubscribeUrl: unsub });
    await prisma.reviewRequest.update({ where: { id }, data: { status: "SENT", sentAt: now, providerMessageId: sent.id, lastError: null } });
    await bumpUsage(prisma, req.shopId, { requestsSent: 1 });
    if (kind === "REQUEST" && settings?.reminderEnabled && hasFeature(ent, "requests.advanced")) {
      await prisma.reviewRequest.createMany({
        data: [{ shopId: req.shopId, kind: "REMINDER", shopifyOrderId: req.shopifyOrderId, shopifyProductId: req.shopifyProductId, shopifyCustomerId: req.shopifyCustomerId, productTitle: req.productTitle, recipientEmail: req.recipientEmail, recipientName: req.recipientName, sendAt: new Date(now.getTime() + settings.reminderDelayDays * 86_400_000) }],
        skipDuplicates: true,
      });
    }
  } catch (e) {
    const retry = nextRetryAt(req.attempts, now);
    const message = (e instanceof Error ? e.message : "send failed").slice(0, 300);
    logger.warn("Review request send failed", { requestId: id, attempts: req.attempts, willRetry: Boolean(retry) });
    await prisma.reviewRequest.update({ where: { id }, data: retry ? { status: "QUEUED", sendAt: retry, lastError: message } : { status: "FAILED", lastError: message } });
  }
}

export async function sendDueRequests(provider: EmailProvider = createEmailProvider(), limit = 20) {
  await prisma.reviewRequest.updateMany({ where: { status: "SENDING", updatedAt: { lt: new Date(Date.now() - 15 * 60_000) } }, data: { status: "QUEUED" } }); // recover crashed sends
  const claimed = await claimRequests(limit);
  for (const { id } of claimed) {
    try { await processRequest(id, provider, new Date()); }
    catch (e) { logger.error("Unexpected error processing request", { requestId: id, error: e }); await prisma.reviewRequest.update({ where: { id }, data: { status: "QUEUED", sendAt: new Date(Date.now() + 10 * 60_000), lastError: "internal error" } }).catch(() => undefined); }
  }
  return claimed.length;
}

async function processImport(shopId: string | null, importJobId: string) {
  const job = await prisma.importJob.findFirst({ where: { id: importJobId, shopId: shopId ?? undefined } });
  if (!job || !job.rows) return;
  const ent = await getEntitlements(job.shopId);
  if (!hasFeature(ent, "csv.import")) { await prisma.importJob.update({ where: { id: job.id }, data: { status: "FAILED", rows: Prisma.DbNull, errorReport: { message: "Your plan no longer includes imports." } } }); return; }
  await prisma.importJob.update({ where: { id: job.id }, data: { status: "RUNNING" } });
  const rows = (job.rows as unknown as (Omit<ImportRow, "createdAt"> & { createdAt: string | null })[]).map((r) => ({ ...r, createdAt: r.createdAt ? new Date(r.createdAt) : null }));
  let imported = 0;
  for (let i = 0; i < rows.length; i += 500) imported += await insertImportedBatch(job.shopId, rows.slice(i, i + 500));
  await prisma.importJob.update({ where: { id: job.id }, data: { status: "COMPLETED", importedRows: imported, skippedRows: rows.length - imported, rows: Prisma.DbNull } });
}

async function purge() {
  const storage = await getStorage();
  const old = await prisma.review.findMany({ where: { deletedAt: { lt: new Date(Date.now() - 30 * 86_400_000) } }, select: { id: true, media: { select: { storageKey: true } } }, take: 500 });
  for (const r of old) if (storage) for (const m of r.media) await storage.remove(m.storageKey).catch(() => undefined);
  if (old.length) await prisma.review.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
  await prisma.webhookEvent.deleteMany({ where: { receivedAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } });
  await prisma.job.deleteMany({ where: { status: { in: ["DONE", "FAILED"] }, updatedAt: { lt: new Date(Date.now() - 14 * 86_400_000) } } });
  await prisma.importJob.deleteMany({ where: { status: "PREVIEW", createdAt: { lt: new Date(Date.now() - 86_400_000) } } });
  // Data minimisation: customer email and name are not kept once a request is finished and 90 days old.
  await prisma.reviewRequest.updateMany({ where: { status: { in: ["SENT", "FAILED", "CANCELLED", "SKIPPED", "COMPLETED"] }, updatedAt: { lt: new Date(Date.now() - 90 * 86_400_000) }, recipientEmail: { not: null } }, data: { recipientEmail: null, recipientName: null } });
}

export async function runJobs() {
  const claimed = await prisma.$queryRaw<{ id: string; type: string; payload: { importJobId?: string }; shopId: string | null }[]>(Prisma.sql`
    UPDATE "Job" SET "status" = 'RUNNING', "lockedAt" = now(), "attempts" = "attempts" + 1, "updatedAt" = now()
    WHERE "id" IN (SELECT "id" FROM "Job" WHERE "status" = 'QUEUED' AND "runAt" <= now() ORDER BY "runAt" LIMIT 5 FOR UPDATE SKIP LOCKED)
    RETURNING "id", "type", "payload", "shopId"`);
  for (const j of claimed) {
    try {
      if (j.type === "IMPORT" && j.payload.importJobId) await processImport(j.shopId, j.payload.importJobId);
      else if (j.type === "PURGE") await purge();
      await prisma.job.update({ where: { id: j.id }, data: { status: "DONE" } });
    } catch (e) {
      logger.error("Job failed", { jobId: j.id, type: j.type, error: e });
      await prisma.job.update({ where: { id: j.id }, data: { status: "FAILED", lastError: (e instanceof Error ? e.message : "failed").slice(0, 300) } });
      if (j.type === "IMPORT" && j.payload.importJobId) await prisma.importJob.updateMany({ where: { id: j.payload.importJobId }, data: { status: "FAILED" } });
    }
  }
}

async function ensureDailyPurge() {
  const recent = await prisma.job.count({ where: { type: "PURGE", createdAt: { gt: new Date(Date.now() - 23 * 3_600_000) } } });
  if (!recent) await prisma.job.create({ data: { type: "PURGE", payload: {} } });
}

export function startWorker(intervalMs = 30_000) {
  let stopping = false;
  const tick = async () => {
    if (stopping) return;
    try { await ensureDailyPurge(); await sendDueRequests(); await runJobs(); }
    catch (e) { logger.error("Worker tick failed", { error: e }); }
  };
  const timer = setInterval(tick, intervalMs);
  void tick();
  logger.info("Worker started", { emailMode: env.email.mode });
  return () => { stopping = true; clearInterval(timer); };
}
