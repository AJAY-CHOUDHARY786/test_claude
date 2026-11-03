// Integration tests for Phase 3. They need a REAL PostgreSQL TEST database and use synthetic data only.
//   DATABASE_URL_TEST=postgresql://user:password@localhost:5432/reviews_test  npm run test:db
// Safety: refuses to run unless the database name contains "test". Creates two fake shops and deletes them afterwards.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

const url = process.env.DATABASE_URL_TEST ?? "";
const dbName = (() => { try { return new URL(url).pathname.slice(1); } catch { return ""; } })();
const skip = !url ? "set DATABASE_URL_TEST to run database tests" : !/test/i.test(dbName) ? "DATABASE_URL_TEST must point at a database whose name contains 'test'" : false;
if (url && skip) throw new Error(String(skip));

// Point the app at the test database BEFORE importing anything that creates a Prisma client.
if (!skip) {
  process.env.DATABASE_URL = url;
  Object.assign(process.env, { SHOPIFY_API_KEY: "test", SHOPIFY_API_SECRET: "test-secret", SCOPES: "read_products", SHOPIFY_APP_URL: "http://localhost:3000" }); // secret-scan:ignore fake test values
}

describe("tenant isolation and data integrity (real PostgreSQL)", { skip }, () => {
  let prisma: any, reviews: any, requests: any, privacy: any;
  let A: any, B: any; // two synthetic shops
  const ids: Record<string, string> = {};

  before(async () => {
    prisma = (await import("../app/db.server.ts")).default;
    reviews = await import("../app/services/reviews.server.ts");
    requests = await import("../app/services/requests.server.ts");
    privacy = await import("../app/services/privacy.server.ts");
    const tag = `t${Date.now()}`;
    A = await prisma.shop.create({ data: { domain: `${tag}-a.myshopify.com`, settings: { create: {} } } });
    B = await prisma.shop.create({ data: { domain: `${tag}-b.myshopify.com`, settings: { create: {} } } });
    const mk = (shopId: string, productId: string, status: string, n: number) =>
      prisma.review.create({ data: { shopId, shopifyProductId: productId, rating: 5, body: `synthetic review ${n}`, reviewerName: "Test Person", status, externalKey: `${shopId}-${n}` } });
    ids.a1 = (await mk(A.id, "111", "PENDING", 1)).id;
    ids.a2 = (await mk(A.id, "111", "PUBLISHED", 2)).id;
    ids.a3 = (await mk(A.id, "111", "PUBLISHED", 3)).id;
    ids.b1 = (await mk(B.id, "111", "PENDING", 4)).id; // same product ID as shop A on purpose
    ids.b2 = (await mk(B.id, "222", "PUBLISHED", 5)).id;
    const rq = (shopId: string, email: string) => prisma.reviewRequest.create({ data: { shopId, shopifyOrderId: "9001", shopifyProductId: "111", productTitle: "Synthetic", recipientEmail: email, sendAt: new Date(Date.now() + 86_400_000) } });
    ids.ra = (await rq(A.id, "shared@example.test")).id; // same order ID and email in both shops on purpose
    ids.rb = (await rq(B.id, "shared@example.test")).id;
    await prisma.reviewReply.create({ data: { shopId: B.id, reviewId: ids.b2, body: "synthetic reply" } });
  });

  after(async () => {
    if (!prisma) return;
    await prisma.shop.deleteMany({ where: { id: { in: [A?.id, B?.id].filter(Boolean) } } }); // cascades
    await prisma.$disconnect();
  });

  test("listing, counting, exporting and stats only ever see the calling shop's data", async () => {
    const list = await reviews.listReviews(A.id, {}, { skip: 0, limit: 50 });
    assert.deepEqual(list.items.map((r: any) => r.id).sort(), [ids.a1, ids.a2, ids.a3].sort());
    assert.equal(list.total, 3);
    assert.equal((await reviews.listReviews(B.id, {}, { skip: 0, limit: 50 })).total, 2);
    const byProduct = await reviews.listReviews(A.id, { productId: "111" }, { skip: 0, limit: 50 });
    assert.equal(byProduct.total, 3, "product 111 exists in both shops but A must see only its own");
    const exported = await reviews.exportRows(A.id);
    assert.equal(exported.length - 1, 3);
    const otherShopReviewId = ids.b1;
    assert.ok(otherShopReviewId);
    assert.ok(!JSON.stringify(exported).includes(otherShopReviewId));
    const stats = await reviews.dashboardStats(A.id);
    assert.equal(stats.ratings.total, 2);
    assert.equal(stats.pending, 1);
    const pub = await reviews.publicReviews(A.id, "111", { page: 1, limit: 20, sort: "newest" });
    assert.equal(pub.total, 2);
  });

  test("a shop cannot read another shop's review by ID", async () => {
    assert.equal(await reviews.getReview(A.id, ids.b1), null);
    assert.ok(await reviews.getReview(B.id, ids.b1));
  });

  test("a shop cannot moderate, edit, reply to, bulk-update or delete another shop's reviews", async () => {
    assert.equal(await reviews.moderateReview(A.id, ids.b1, "approve", "test"), null);
    assert.equal(await reviews.editReview(A.id, ids.b1, { title: null, body: "hacked", reviewerName: "x" }, "test"), null);
    assert.equal(await reviews.replyToReview(A.id, ids.b1, "hacked reply", "test"), null);
    assert.equal(await reviews.softDeleteReview(A.id, ids.b1, "test"), false);
    assert.equal(await reviews.deleteReply(A.id, ids.b2, "test"), false);
    const changed = await reviews.bulkModerate(A.id, [ids.a1, ids.b1, ids.b2], "hide", "test");
    assert.equal(changed, 1, "only shop A's own pending review changes (b1 and b2 belong to shop B and are ignored)");
    const b1 = await prisma.review.findUnique({ where: { id: ids.b1 } });
    assert.equal(b1.status, "PENDING");
    assert.equal(b1.body, "synthetic review 4");
    assert.equal(b1.deletedAt, null);
    assert.equal(await prisma.reviewReply.count({ where: { reviewId: ids.b2 } }), 1);
    assert.equal((await prisma.review.findUnique({ where: { id: ids.b2 } })).status, "PUBLISHED");
  });

  test("moderation, edit, reply and delete work for the owning shop and leave an audit trail", async () => {
    assert.ok(await reviews.moderateReview(B.id, ids.b1, "approve", "test"));
    assert.equal((await prisma.review.findUnique({ where: { id: ids.b1 } })).status, "PUBLISHED");
    assert.ok(await reviews.replyToReview(B.id, ids.b1, "thanks", "test"));
    assert.ok(await reviews.replyToReview(B.id, ids.b1, "thanks again", "test"), "second reply updates instead of failing");
    assert.equal(await prisma.reviewReply.count({ where: { reviewId: ids.b1 } }), 1);
    assert.ok(await reviews.editReview(B.id, ids.b1, { title: "t", body: "edited", reviewerName: "n" }, "test"));
    const events = await prisma.moderationEvent.findMany({ where: { reviewId: ids.b1, shopId: B.id } });
    assert.ok(events.length >= 3);
    assert.ok(events.every((e: any) => e.shopId === B.id));
  });

  test("review requests, manual send, cancellation and unsubscribes never cross shops", async () => {
    const [listA] = await requests.listRequests(A.id, undefined, { skip: 0, limit: 50 });
    assert.deepEqual(listA.map((r: any) => r.id), [ids.ra]);
    assert.equal(await requests.sendRequestNow(A.id, ids.rb), false);
    assert.equal(await requests.cancelRequestsForOrder(A.id, "9001"), 1, "same order ID exists in both shops; only A's request is cancelled");
    assert.equal((await prisma.reviewRequest.findUnique({ where: { id: ids.rb } })).status, "QUEUED");
    await requests.suppressEmail(B.id, "shared@example.test", "unsubscribed");
    assert.equal((await prisma.reviewRequest.findUnique({ where: { id: ids.rb } })).status, "CANCELLED");
    assert.equal(await prisma.suppression.count({ where: { shopId: A.id } }), 0, "unsubscribing in B must not suppress the same address in A");
  });

  test("a review cannot be linked to another shop's review request", async () => {
    const input = { productId: "111", rating: 5, title: null, body: "synthetic linked", reviewerName: "T" };
    await assert.rejects(() => reviews.createReview(A.id, input, { verified: true, requestId: ids.rb, autoPublish: false }), /does not belong/);
    assert.equal(await prisma.review.count({ where: { requestId: ids.rb } }), 0);
  });

  test("unique constraints: duplicate imports and duplicate requests are ignored, not duplicated", async () => {
    const row = { productId: "333", rating: 4, title: null, body: "imported", reviewerName: "I", status: "PUBLISHED", createdAt: null, reply: "ok", externalKey: `ext-${A.id}` };
    assert.equal(await reviews.insertImportedBatch(A.id, [row]), 1);
    assert.equal(await reviews.insertImportedBatch(A.id, [row]), 0);
    assert.equal(await prisma.reviewReply.count({ where: { shopId: A.id } }), 1);
    const sameKeyOtherShop = await reviews.insertImportedBatch(B.id, [row]);
    assert.equal(sameKeyOtherShop, 1, "the same import key is allowed in a different shop");
    const dup = await prisma.reviewRequest.createMany({ data: [{ shopId: A.id, shopifyOrderId: "9001", shopifyProductId: "111", productTitle: "x", sendAt: new Date() }], skipDuplicates: true });
    assert.equal(dup.count, 0);
  });

  test("the database CHECK constraints and partial indexes are installed and enforced (run `npm run db:constraints` first)", async () => {
    const found = await prisma.$queryRawUnsafe(`SELECT conname FROM pg_constraint WHERE conname IN ('review_rating_range','settings_layout_known','media_size_range')`);
    assert.equal(found.length, 3, "constraints missing: run npm run db:constraints against the test database");
    await assert.rejects(() => prisma.review.create({ data: { shopId: A.id, shopifyProductId: "1", rating: 9, body: "x", reviewerName: "n" } }), /review_rating_range|check/i);
    await assert.rejects(() => prisma.review.create({ data: { shopId: A.id, shopifyProductId: "1", rating: 3, body: "", reviewerName: "n" } }), /review_body_length|check/i);
    const idx = await prisma.$queryRawUnsafe(`SELECT indexname FROM pg_indexes WHERE indexname IN ('ReviewRequest_due_idx','Review_public_idx','Review_purge_idx')`);
    assert.equal(idx.length, 3);
  });

  test("deleting a shop (shop/redact) removes every row it owns and nothing else", async () => {
    const owned = ["review", "reviewMedia", "reviewReply", "moderationEvent", "reviewRequest", "emailTemplate", "suppression", "question", "answer", "importJob", "usageStat", "auditLog", "productWidgetSetting", "shopSettings", "subscription"] as const;
    await prisma.question.create({ data: { shopId: B.id, shopifyProductId: "1", body: "synthetic q", askerName: "x" } });
    await prisma.auditLog.create({ data: { shopId: B.id, actor: "test", action: "test" } });
    const before = await prisma.review.count({ where: { shopId: A.id } });
    await privacy.redactShop(B.domain);
    for (const m of owned) assert.equal(await prisma[m].count({ where: { shopId: B.id } }), 0, `${m} rows left behind`);
    assert.equal(await prisma.shop.count({ where: { id: B.id } }), 0);
    assert.equal(await prisma.review.count({ where: { shopId: A.id } }), before, "shop A is untouched");
    assert.equal(await prisma.privacyEvent.count({ where: { shopDomain: B.domain } }), 1, "the erasure itself is recorded without personal data");
  });

  test("customer redaction anonymises reviews and removes contact details only for that shop", async () => {
    const req = await prisma.reviewRequest.create({ data: { shopId: A.id, shopifyOrderId: "7777", shopifyProductId: "111", shopifyCustomerId: "555", productTitle: "x", recipientEmail: "person@example.test", recipientName: "Person", sendAt: new Date() } });
    const rev = await prisma.review.create({ data: { shopId: A.id, shopifyProductId: "111", rating: 5, body: "named review", reviewerName: "Person", requestId: req.id } });
    await privacy.redactCustomer(A.domain, { customer: { id: 555 }, orders_to_redact: [7777] });
    const r = await prisma.reviewRequest.findUnique({ where: { id: req.id } });
    assert.equal(r.recipientEmail, null); assert.equal(r.recipientName, null); assert.equal(r.shopifyCustomerId, null);
    assert.equal((await prisma.review.findUnique({ where: { id: rev.id } })).reviewerName, "Anonymous");
  });
});
