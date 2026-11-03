import { test } from "node:test";
import assert from "node:assert/strict";
import { processWebhook, normalizeTopic, type WebhookStore } from "../app/lib/webhook-core.ts";
import { pickSubscription } from "../app/lib/subscription-sync.ts";
import { toOrderForRequests } from "../app/lib/orders.ts";
import { buildGeneralUpdate, buildRequestsUpdate, clampInt, parseExcludedProducts, validateProductOverride, validateWidgetUpdate } from "../app/lib/settings-validation.ts";
import { parsePrivacyPayload, privacyWhere } from "../app/lib/privacy-payload.ts";
import { parseListParams } from "../app/lib/proxy-params.ts";
import { planReviewRequests } from "../app/lib/request-scheduler.ts";

const form = (o: Record<string, unknown>) => ({ get: (k: string) => (k in o ? o[k] : null) });

/* ---------- webhooks ---------- */
function fakeStore(over: Partial<WebhookStore> = {}) {
  const seen = new Set<string>(); const calls: string[] = [];
  const store: WebhookStore = {
    claim: async (id) => { calls.push(`claim:${id}`); if (seen.has(id)) return false; seen.add(id); return true; },
    markProcessed: async (id) => { calls.push(`done:${id}`); },
    release: async (id) => { calls.push(`release:${id}`); seen.delete(id); },
    ...over,
  };
  return { store, calls, seen };
}
const log = { info() {}, warn() {}, error() {} };

test("webhooks: first delivery runs the handler once and is marked processed", async () => {
  const { store, calls } = fakeStore(); let ran = 0;
  assert.equal(await processWebhook({ id: "w1", shop: "s", topic: "T", handler: async () => { ran++; }, store, log }), 200);
  assert.equal(ran, 1); assert.deepEqual(calls, ["claim:w1", "done:w1"]);
});

test("webhooks: a duplicate delivery is acknowledged without running the handler again", async () => {
  const { store } = fakeStore(); let ran = 0;
  const h = async () => { ran++; };
  await processWebhook({ id: "w1", shop: "s", topic: "T", handler: h, store, log });
  assert.equal(await processWebhook({ id: "w1", shop: "s", topic: "T", handler: h, store, log }), 200);
  assert.equal(ran, 1);
});

test("webhooks: a failing handler returns 500, releases the claim, and the retry runs again", async () => {
  const { store, calls } = fakeStore(); let n = 0;
  const flaky = async () => { n++; if (n === 1) throw new Error("db down"); };
  assert.equal(await processWebhook({ id: "w2", shop: "s", topic: "T", handler: flaky, store, log }), 500);
  assert.ok(calls.includes("release:w2"));
  assert.equal(await processWebhook({ id: "w2", shop: "s", topic: "T", handler: flaky, store, log }), 200);
  assert.equal(n, 2);
});

test("webhooks: if recording the webhook fails Shopify is asked to retry and the handler does not run", async () => {
  const { store } = fakeStore({ claim: async () => { throw new Error("db down"); } }); let ran = false;
  assert.equal(await processWebhook({ id: "w3", shop: "s", topic: "T", handler: async () => { ran = true; }, store, log }), 500);
  assert.equal(ran, false);
});

test("webhooks: failing to mark processed does not turn a success into a retry", async () => {
  const { store } = fakeStore({ markProcessed: async () => { throw new Error("db blip"); } });
  assert.equal(await processWebhook({ id: "w4", shop: "s", topic: "T", handler: async () => {}, store, log }), 200);
});

test("webhooks: a release failure still returns 500, and deliveries without an ID still run", async () => {
  const { store } = fakeStore({ release: async () => { throw new Error("x"); } });
  assert.equal(await processWebhook({ id: "w5", shop: "s", topic: "T", handler: async () => { throw new Error("boom"); }, store, log }), 500);
  let ran = false;
  assert.equal(await processWebhook({ id: null, shop: "s", topic: "T", handler: async () => { ran = true; }, store, log }), 200);
  assert.ok(ran);
});

test("webhook topics are normalised from either Shopify format", () => {
  assert.equal(normalizeTopic("orders/fulfilled"), "ORDERS_FULFILLED");
  assert.equal(normalizeTopic("APP_UNINSTALLED"), "APP_UNINSTALLED");
  assert.equal(normalizeTopic("customers/data_request"), "CUSTOMERS_DATA_REQUEST");
  assert.equal(normalizeTopic("shop.redact"), "SHOP_REDACT");
});

/* ---------- subscription sync ---------- */
const sub = (o: Partial<Parameters<typeof pickSubscription>[0][0]> = {}) => ({ id: "gid://shopify/AppSubscription/1", name: "Basic", status: "ACTIVE", trialDays: 30, createdAt: "2026-01-01T00:00:00Z", currentPeriodEnd: "2026-02-01T00:00:00Z", test: false, ...o });

test("subscription sync: a single Basic subscription becomes the Basic plan with a trial end date", () => {
  const { data } = pickSubscription([sub()]);
  assert.equal(data.plan, "basic"); assert.equal(data.status, "ACTIVE");
  assert.equal(data.trialEndsAt?.toISOString(), "2026-01-31T00:00:00.000Z");
  assert.equal(data.shopifySubscriptionId, "gid://shopify/AppSubscription/1");
});

test("subscription sync: Advanced wins if Shopify reports both; unknown names and inactive ones are ignored", () => {
  assert.equal(pickSubscription([sub(), sub({ name: "Advanced", id: "2" })]).data.plan, "advanced");
  const unknown = pickSubscription([sub({ name: "Gold" })]);
  assert.equal(unknown.data.plan, null); assert.equal(unknown.unrecognised, true); assert.equal(unknown.data.status, "NONE");
  assert.equal(pickSubscription([sub({ status: "CANCELLED" })]).data.plan, null);
});

test("subscription sync: no subscriptions means no plan, and bad dates never crash", () => {
  const none = pickSubscription([]);
  assert.deepEqual([none.data.plan, none.data.status, none.unrecognised], [null, "NONE", false]);
  const odd = pickSubscription([sub({ createdAt: "not a date", currentPeriodEnd: "also bad", trialDays: 0 })]).data;
  assert.equal(odd.trialEndsAt, null); assert.equal(odd.currentPeriodEnd, null); assert.equal(odd.plan, "basic");
});

/* ---------- orders ---------- */
const now = new Date("2026-06-15T00:00:00Z");
test("orders: uses the newest fulfilment time, then the last update, then now", () => {
  const withFulfilments = toOrderForRequests({ id: 1, email: "a@b.co", updated_at: "2026-05-01T00:00:00Z", fulfillments: [{ created_at: "2026-05-02T00:00:00Z" }, { created_at: "2026-05-04T00:00:00Z" }] }, now)!;
  assert.equal(withFulfilments.fulfilledAt.toISOString(), "2026-05-04T00:00:00.000Z");
  assert.equal(toOrderForRequests({ id: 1, updated_at: "2026-05-01T00:00:00Z" }, now)!.fulfilledAt.toISOString(), "2026-05-01T00:00:00.000Z");
  assert.equal(toOrderForRequests({ id: 1 }, now)!.fulfilledAt, now);
  assert.equal(toOrderForRequests({ id: 1, fulfillments: [{ created_at: "junk" }], updated_at: "junk" }, now)!.fulfilledAt, now);
});

test("orders: rejects missing IDs and invalid emails, flags cancelled and test orders, and cleans line items", () => {
  assert.equal(toOrderForRequests({}, now), null);
  assert.equal(toOrderForRequests({ id: "" }, now), null);
  assert.equal(toOrderForRequests({ id: 1, email: "not-an-email" }, now)!.email, null);
  assert.equal(toOrderForRequests({ id: 1, email: "  Ann@Shop.com " }, now)!.email, "Ann@Shop.com");
  assert.equal(toOrderForRequests({ id: 1, email: null }, now)!.email, null);
  const o = toOrderForRequests({ id: 7, cancelled_at: "2026-01-01", test: true, line_items: [{ product_id: 12, title: "Mug" }, { product_id: null, title: null }, { product_id: 0, title: "x".repeat(500) }] }, now)!;
  assert.equal(o.orderId, "7"); assert.equal(o.cancelled, true); assert.equal(o.isTest, true);
  assert.deepEqual(o.lineItems.map((l) => l.productId), ["12", null, null]);
  assert.equal(o.lineItems[1]!.title, "your item"); assert.equal(o.lineItems[2]!.title.length, 200);
});

test("orders: a realistic webhook payload flows through to scheduled requests", () => {
  const order = toOrderForRequests({ id: 99, email: "buyer@example.com", fulfillments: [{ created_at: "2026-06-01T00:00:00Z" }], line_items: [{ product_id: 5, title: "Lamp" }, { product_id: 5, title: "Lamp again" }, { product_id: 6, title: "Shade" }] }, now)!;
  const plan = planReviewRequests(order, { enabled: true, delayDays: 7, maxProductsPerOrder: 3, excludedProductIds: [] }, () => false);
  assert.deepEqual(plan.requests.map((r) => r.productId), ["5", "6"]);
  assert.equal(plan.requests[0]!.sendAt.toISOString(), "2026-06-08T00:00:00.000Z");
});

/* ---------- settings gating ---------- */
test("settings: Basic merchants cannot change advanced request settings, even by forging the form", () => {
  const forged = form({ requestsEnabled: "on", requestDelayDays: "60", maxProductsPerOrder: "9", reminderEnabled: "on", reminderDelayDays: "10", excludedProductIds: "1,2", senderName: "Boss", replyToEmail: "x@y.co" });
  const basic = buildRequestsUpdate(forged, false);
  assert.deepEqual(Object.keys(basic).sort(), ["requestDelayDays", "requestsEnabled"]);
  assert.equal(basic.requestDelayDays, 30, "Basic delay is capped at 30 days");
  const adv = buildRequestsUpdate(forged, true);
  assert.equal(adv.requestDelayDays, 60); assert.equal(adv.maxProductsPerOrder, 9); assert.equal(adv.reminderEnabled, true);
  assert.deepEqual(adv.excludedProductIds, ["1", "2"]); assert.equal(adv.replyToEmail, "x@y.co");
});

test("settings: numbers are clamped to the same ranges the database enforces", () => {
  assert.equal(clampInt("999", 5, 50, 10), 50); assert.equal(clampInt("-4", 5, 50, 10), 5); assert.equal(clampInt("abc", 5, 50, 10), 10); assert.equal(clampInt("7.5", 5, 50, 10), 10);
  assert.equal(buildGeneralUpdate(form({ reviewsPerPage: "1000" })).reviewsPerPage, 50);
  assert.equal(buildGeneralUpdate(form({})).autoPublish, false);
  assert.equal(buildRequestsUpdate(form({ requestDelayDays: "-5" }), true).requestDelayDays, 0);
  assert.equal(buildRequestsUpdate(form({ requestDelayDays: "0" }), false).requestDelayDays, 1);
  assert.equal(buildRequestsUpdate(form({ maxProductsPerOrder: "99", reminderDelayDays: "1" }), true).maxProductsPerOrder, 10);
  assert.equal(buildRequestsUpdate(form({ reminderDelayDays: "1" }), true).reminderDelayDays, 3);
});

test("settings: excluded products, sender name and reply-to are sanitised", () => {
  assert.deepEqual(parseExcludedProducts("1, 2,abc,,3;4, 99999999999999999999999"), ["1", "2"]);
  assert.equal(parseExcludedProducts(Array.from({ length: 300 }, (_, i) => i + 1).join(",")).length, 200);
  const u = buildRequestsUpdate(form({ senderName: ' <b>"Shop"</b>\n', replyToEmail: "not an email" }), true);
  assert.equal(u.senderName, "bShop/b"); assert.equal(u.replyToEmail, null);
});

test("settings: widget and per-product overrides accept only safe colors and layouts", () => {
  assert.deepEqual(validateWidgetUpdate(form({ widgetAccentColor: "#1f4b3f", widgetLayout: "grid" })), { ok: true, value: { widgetAccentColor: "#1f4b3f", widgetLayout: "grid" } });
  for (const bad of ["red", "#12", "#1f4b3f;background:url(x)", "javascript:alert(1)", ""]) assert.equal(validateWidgetUpdate(form({ widgetAccentColor: bad })).ok, false, bad);
  assert.equal(validateWidgetUpdate(form({ widgetAccentColor: "#1f4b3f", widgetLayout: "carousel" })).ok, false);
  assert.deepEqual(validateProductOverride(form({ hidden: "on", layout: "", accentColor: "" })), { ok: true, value: { hidden: true, layout: null, accentColor: null } });
  assert.equal(validateProductOverride(form({ accentColor: "blue" })).ok, false);
  assert.equal(validateProductOverride(form({ layout: "wall" })).ok, false);
});

/* ---------- privacy payloads ---------- */
test("privacy: reads customer and order IDs from numbers or strings and ignores junk", () => {
  assert.deepEqual(parsePrivacyPayload({ customer: { id: 123 }, orders_to_redact: [1, "2", "x", null, {}] }, "orders_to_redact"), { customerId: "123", orderIds: ["1", "2"] });
  assert.deepEqual(parsePrivacyPayload({ customer: { id: "55" }, orders_requested: [9] }, "orders_requested"), { customerId: "55", orderIds: ["9"] });
  for (const junk of [null, undefined, "str", 5, [], { customer: null }, { customer: { id: "../x" } }]) assert.deepEqual(parsePrivacyPayload(junk, "orders_requested"), { customerId: null, orderIds: [] }, JSON.stringify(junk));
  assert.equal(parsePrivacyPayload({ orders_requested: Array.from({ length: 900 }, (_, i) => i + 1) }, "orders_requested").orderIds.length, 500);
});

test("privacy: a payload with no identifiers never produces a query (so it can never match every record)", () => {
  assert.equal(privacyWhere("shop1", { customerId: null, orderIds: [] }), null);
  assert.deepEqual(privacyWhere("shop1", { customerId: "7", orderIds: [] }), { shopId: "shop1", OR: [{ shopifyCustomerId: "7" }] });
  const both = privacyWhere("shop1", { customerId: "7", orderIds: ["1"] })!;
  assert.equal(both.shopId, "shop1"); assert.equal(both.OR.length, 2);
});

/* ---------- storefront list params ---------- */
test("storefront list params: valid input is parsed and clamped", () => {
  const p = parseListParams(new URLSearchParams("product_id=123&page=2&sort=highest&rating=4&summary=1"), 10)!;
  assert.deepEqual([p.productId, p.page, p.limit, p.skip, p.sort, p.rating, p.summaryOnly], ["123", 2, 10, 10, "highest", 4, true]);
  const d = parseListParams(new URLSearchParams("product_id=9&sort=evil&rating=99&page=-1&limit=1000"), 10)!;
  assert.deepEqual([d.sort, d.rating, d.page, d.limit, d.summaryOnly], ["newest", undefined, 1, 50, false]);
});

test("storefront list params: a missing or malformed product ID is rejected", () => {
  for (const bad of ["", "product_id=abc", "product_id=1;DROP", "product_id=" + "9".repeat(25)]) assert.equal(parseListParams(new URLSearchParams(bad), 10), null, bad);
});

import { parsePagination } from "../app/lib/pagination.ts";
test("pagination: missing or blank parameters use the defaults instead of collapsing to one item per page", () => {
  assert.deepEqual(parsePagination(new URLSearchParams("")), { page: 1, limit: 25, skip: 0 });
  assert.deepEqual(parsePagination(new URLSearchParams("page=&limit=")), { page: 1, limit: 25, skip: 0 });
  assert.deepEqual(parsePagination(new URLSearchParams("page=3"), { defaultLimit: 10, maxLimit: 50 }), { page: 3, limit: 10, skip: 20 });
  assert.deepEqual(parsePagination(new URLSearchParams("limit=0")), { page: 1, limit: 1, skip: 0 }, "an explicit 0 is clamped to the minimum");
});
