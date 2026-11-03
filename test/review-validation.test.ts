import { test } from "node:test";
import assert from "node:assert/strict";
import { validateReviewSubmission, sanitizeText, escapeHtml } from "../app/lib/review-validation.ts";

const good = { productId: "123", rating: "5", title: " Great ", body: "Works really well", name: "Ann" };

test("accepts a valid submission and trims fields", () => {
  const r = validateReviewSubmission(good);
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.value, { productId: "123", rating: 5, title: "Great", body: "Works really well", reviewerName: "Ann" });
});

test("rejects bad ratings, product IDs, empty body and missing name with field errors", () => {
  for (const rating of ["0", "6", "4.5", "abc", ""]) assert.ok(!validateReviewSubmission({ ...good, rating }).ok, rating);
  const r = validateReviewSubmission({ productId: "../etc", rating: 3, body: "x", name: "" });
  assert.ok(!r.ok);
  if (!r.ok) assert.deepEqual(Object.keys(r.errors).sort(), ["body", "name", "productId"]);
});

test("a filled honeypot is treated as a bot", () => {
  const r = validateReviewSubmission({ ...good, website: "http://spam" });
  assert.ok(!r.ok && r.bot);
});

test("clients cannot claim verified-purchase status through input", () => {
  const r = validateReviewSubmission({ ...good, verified: true, verifiedPurchase: "true", status: "PUBLISHED" });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(Object.keys(r.value).sort(), ["body", "productId", "rating", "reviewerName", "title"]);
});

test("sanitizes control and bidi characters, collapses blank lines and caps length", () => {
  assert.equal(sanitizeText("a\u0000b\u202Ec\n\n\n\nd", 100), "abc\n\nd");
  assert.equal(sanitizeText("x".repeat(500), 10).length, 10);
});

test("escapeHtml neutralizes markup", () => {
  assert.equal(escapeHtml(`<img src=x onerror="a('b')">&`), "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
});
