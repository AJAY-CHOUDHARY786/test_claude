import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { verifySvixSignature } from "../app/lib/svix.ts";
import { mapEmailEvent } from "../app/lib/email-events.ts";
import { isQualifyingOrder, anyQualifyingOrder } from "../app/lib/purchase.ts";
import { STOREFRONT_LOCALES } from "../app/lib/locales.ts";

const now = new Date("2026-06-15T12:00:00Z");
const ts = String(Math.floor(now.getTime() / 1000));
const rawKey = Buffer.from("super-secret-bytes-for-test-only");
const secret = `whsec_${rawKey.toString("base64")}`;
const body = JSON.stringify({ type: "email.delivered", data: { email_id: "e1" } });
const sign = (id: string, t: string, b: string) => createHmac("sha256", rawKey).update(`${id}.${t}.${b}`).digest("base64");

test("svix: accepts a valid signature, including when several are listed", () => {
  const sig = `v1,${sign("m1", ts, body)}`;
  assert.equal(verifySvixSignature({ secret, id: "m1", timestamp: ts, body, signatureHeader: sig, now }), true);
  assert.equal(verifySvixSignature({ secret, id: "m1", timestamp: ts, body, signatureHeader: `v1,AAAA ${sig}`, now }), true);
});

test("svix: rejects tampered body, wrong id, wrong secret, stale timestamp and missing parts", () => {
  const sig = `v1,${sign("m1", ts, body)}`;
  const base = { secret, id: "m1", timestamp: ts, body, signatureHeader: sig, now };
  assert.equal(verifySvixSignature({ ...base, body: body + " " }), false);
  assert.equal(verifySvixSignature({ ...base, id: "m2" }), false);
  assert.equal(verifySvixSignature({ ...base, secret: `whsec_${Buffer.from("other").toString("base64")}` }), false);
  assert.equal(verifySvixSignature({ ...base, now: new Date(now.getTime() + 3_600_000) }), false);
  assert.equal(verifySvixSignature({ ...base, signatureHeader: "" }), false);
  assert.equal(verifySvixSignature({ ...base, signatureHeader: `v2,${sign("m1", ts, body)}` }), false);
  assert.equal(verifySvixSignature({ ...base, secret: "" }), false);
});

test("email events: only provider-confirmed outcomes are recorded; bounces and complaints suppress", () => {
  assert.deepEqual(mapEmailEvent("email.delivered"), { deliveryStatus: "delivered", setDeliveredAt: true, suppress: false });
  assert.equal(mapEmailEvent("email.bounced")?.suppress, true);
  assert.equal(mapEmailEvent("email.complained")?.suppress, true);
  assert.equal(mapEmailEvent("email.delivery_delayed")?.suppress, false);
  assert.equal(mapEmailEvent("email.sent"), null);
  assert.equal(mapEmailEvent("email.opened"), null);
});

test("purchase check: paid, uncancelled orders qualify; cancelled, unpaid or refunded do not", () => {
  assert.equal(isQualifyingOrder({ displayFinancialStatus: "PAID" }), true);
  assert.equal(isQualifyingOrder({ displayFinancialStatus: "partially_refunded" }), true);
  assert.equal(isQualifyingOrder({ displayFinancialStatus: "PAID", cancelledAt: "2026-01-01" }), false);
  for (const s of ["PENDING", "REFUNDED", "VOIDED", "AUTHORIZED", "", null, undefined]) assert.equal(isQualifyingOrder({ displayFinancialStatus: s }), false, String(s));
  assert.equal(anyQualifyingOrder([]), false);
  assert.equal(anyQualifyingOrder([{ displayFinancialStatus: "PENDING" }, { displayFinancialStatus: "PAID" }]), true);
});

const load = (name: string) => JSON.parse(readFileSync(new URL(`../extensions/review-widgets/locales/${name}.json`, import.meta.url), "utf8")).reviews as Record<string, string>;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("every storefront language has exactly the same keys and placeholders as English", () => {
  const en = load("en.default");
  for (const loc of STOREFRONT_LOCALES) {
    const t = load(loc);
    assert.deepEqual(Object.keys(t).sort(), Object.keys(en).sort(), `${loc} keys`);
    for (const k of Object.keys(en)) {
      assert.ok(t[k]!.trim().length > 0, `${loc}.${k} empty`);
      assert.equal(placeholders(t[k]!), placeholders(en[k]!), `${loc}.${k} placeholders`);
    }
  }
});

test("the Liquid block asks for every translation key the script uses", () => {
  const liquid = readFileSync(new URL("../extensions/review-widgets/blocks/product-reviews.liquid", import.meta.url), "utf8");
  const listed = liquid.match(/assign keys = '([^']+)'/)![1]!.split(",");
  const en = load("en.default");
  for (const k of listed) assert.ok(k in en, `${k} missing from locale`);
  const js = readFileSync(new URL("../extensions/review-widgets/assets/reviews.js", import.meta.url), "utf8");
  for (const k of new Set([...js.matchAll(/strings\.(\w+)/g)].map((m) => m[1]!))) assert.ok(listed.includes(k), `script uses strings.${k} but the block does not provide it`);
});
