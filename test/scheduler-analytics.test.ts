import { test } from "node:test";
import assert from "node:assert/strict";
import { planReviewRequests, decideSend, nextRetryAt } from "../app/lib/request-scheduler.ts";
import { summarizeRatings, bucketByWeek } from "../app/lib/analytics.ts";
import { buildProductJsonLd } from "../app/lib/structured-data.ts";
import { parsePagination } from "../app/lib/pagination.ts";

const settings = { enabled: true, delayDays: 7, maxProductsPerOrder: 3, excludedProductIds: ["99"] };
const order = (over: any = {}) => ({
  orderId: "o1", fulfilledAt: new Date("2026-06-01T00:00:00Z"), cancelled: false, isTest: false, email: "a@b.com",
  lineItems: [{ productId: "1", title: "A" }, { productId: "1", title: "A again" }, { productId: "99", title: "Excluded" }, { productId: null, title: "Custom" }, { productId: "2", title: "B" }],
  ...over,
});
const none = () => false;

test("plans one request per eligible product after the configured delay", () => {
  const r = planReviewRequests(order(), settings, none);
  assert.deepEqual(r.requests.map((x) => x.productId), ["1", "2"]);
  assert.equal(r.requests[0]!.sendAt.toISOString(), "2026-06-08T00:00:00.000Z");
});

test("skips disabled, cancelled, test, email-less and suppressed orders", () => {
  assert.equal(planReviewRequests(order(), { ...settings, enabled: false }, none).skipped, "disabled");
  assert.equal(planReviewRequests(order({ cancelled: true }), settings, none).skipped, "cancelled");
  assert.equal(planReviewRequests(order({ isTest: true }), settings, none).skipped, "test_order");
  assert.equal(planReviewRequests(order({ email: null }), settings, none).skipped, "no_email");
  assert.equal(planReviewRequests(order(), settings, () => true).skipped, "suppressed");
  assert.equal(planReviewRequests(order({ lineItems: [{ productId: null, title: "x" }] }), settings, none).skipped, "no_eligible_products");
});

test("caps products per order and clamps absurd delays", () => {
  const many = order({ lineItems: Array.from({ length: 10 }, (_, i) => ({ productId: String(i + 1), title: "p" })) });
  assert.equal(planReviewRequests(many, { ...settings, maxProductsPerOrder: 2 }, none).requests.length, 2);
  const far = planReviewRequests(order(), { ...settings, delayDays: 10_000 }, none).requests[0]!;
  assert.equal(far.sendAt.toISOString(), "2026-08-30T00:00:00.000Z");
});

test("send decision respects status, cancellation, due time, suppression and plan", () => {
  const now = new Date("2026-06-10T00:00:00Z");
  const req = { status: "QUEUED", cancelledAt: null, sendAt: new Date("2026-06-09T00:00:00Z") };
  const ctx = { suppressed: false, entitled: true, now };
  assert.equal(decideSend(req, ctx), "send");
  assert.equal(decideSend({ ...req, status: "SENT" }, ctx), "not_queued");
  assert.equal(decideSend({ ...req, cancelledAt: now }, ctx), "cancelled");
  assert.equal(decideSend({ ...req, sendAt: new Date("2026-06-11T00:00:00Z") }, ctx), "not_due");
  assert.equal(decideSend(req, { ...ctx, suppressed: true }), "suppressed");
  assert.equal(decideSend(req, { ...ctx, entitled: false }), "not_entitled");
});

test("retry backoff grows, is capped, and stops after max attempts", () => {
  const now = new Date("2026-06-10T00:00:00Z");
  const mins = (a: number) => (nextRetryAt(a, now)!.getTime() - now.getTime()) / 60000;
  assert.deepEqual([1, 2, 3].map(mins), [5, 20, 80]);
  assert.equal(nextRetryAt(5, now), null);
  assert.ok(mins(4) <= 24 * 60);
});

test("rating summary computes real averages and handles zero reviews", () => {
  const s = summarizeRatings({ 5: 3, 4: 1 });
  assert.equal(s.total, 4);
  assert.equal(s.average, 4.75);
  assert.deepEqual(s.distribution.map((d) => d.percent), [75, 25, 0, 0, 0]);
  assert.equal(summarizeRatings({}).average, null);
});

test("weekly buckets cover the requested range with correct counts", () => {
  const now = new Date("2026-06-17T10:00:00Z");
  const b = bucketByWeek([new Date("2026-06-16T00:00:00Z"), new Date("2026-06-15T00:00:00Z"), new Date("2026-06-08T00:00:00Z"), new Date("2020-01-01T00:00:00Z")], 3, now);
  assert.deepEqual(b, [{ weekStart: "2026-06-01", count: 0 }, { weekStart: "2026-06-08", count: 1 }, { weekStart: "2026-06-15", count: 2 }]);
});

test("structured data appears only with real data and cannot break out of a script tag", () => {
  assert.equal(buildProductJsonLd({ productName: "P", reviewCount: 0, averageRating: 0, reviews: [] }), null);
  assert.equal(buildProductJsonLd({ productName: "P", reviewCount: 3, averageRating: 7, reviews: [] }), null);
  const json = buildProductJsonLd({ productName: "P</script><script>alert(1)", reviewCount: 1, averageRating: 4.26, reviews: [{ author: "A", rating: 4, body: "ok <b>", datePublished: new Date("2026-01-02T00:00:00Z") }] })!;
  assert.ok(!json.includes("</script>") && !json.includes("<b>"));
  const parsed = JSON.parse(json);
  assert.equal(parsed.aggregateRating.ratingValue, 4.3);
  assert.equal(parsed.review[0].datePublished, "2026-01-02");
});

test("pagination clamps bad input", () => {
  assert.deepEqual(parsePagination(new URLSearchParams("page=3&limit=10")), { page: 3, limit: 10, skip: 20 });
  assert.deepEqual(parsePagination(new URLSearchParams("page=-5&limit=99999")), { page: 1, limit: 100, skip: 0 });
  assert.deepEqual(parsePagination(new URLSearchParams("page=abc&limit=x")), { page: 1, limit: 25, skip: 0 });
});

import { clientIp } from "../app/lib/http.ts";
test("client IP prefers the trusted header set by Express and validates values", () => {
  assert.equal(clientIp(new Headers({ "x-client-ip": "198.51.100.9", "x-forwarded-for": "203.0.113.5" })), "198.51.100.9");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" })), "203.0.113.5");
  assert.equal(clientIp(new Headers({ "x-client-ip": "<script>" })), "unknown");
  assert.equal(clientIp(new Headers()), "unknown");
});
