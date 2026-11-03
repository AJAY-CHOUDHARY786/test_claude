import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { signPayload, verifySignedPayload, hashEmail, randomToken, sha256Hex } from "../app/lib/tokens.ts";
import { verifyAppProxySignature } from "../app/lib/app-proxy.ts";
import { createRateLimiter } from "../app/lib/rate-limit.ts";

const now = new Date("2026-06-15T12:00:00Z");

test("signed payloads verify, expire, and reject tampering or a wrong secret", () => {
  const t = signPayload("s3cret", { shop: "a", h: "x" }, new Date("2026-06-16T00:00:00Z"));
  assert.equal(verifySignedPayload("s3cret", t, now)?.shop, "a");
  assert.equal(verifySignedPayload("other", t, now), null);
  assert.equal(verifySignedPayload("s3cret", t, new Date("2026-06-17T00:00:00Z")), null);
  const [body, sig] = t.split(".") as [string, string];
  const forged = Buffer.from(JSON.stringify({ shop: "evil", exp: 9999999999 })).toString("base64url");
  assert.equal(verifySignedPayload("s3cret", `${forged}.${sig}`, now), null);
  assert.equal(verifySignedPayload("s3cret", "garbage", now), null);
  assert.equal(verifySignedPayload("s3cret", `${body}.`, now), null);
});

test("email hashes are case-insensitive, shop-specific and never contain the address", () => {
  assert.equal(hashEmail("s1", "Ann@Example.com "), hashEmail("s1", "ann@example.com"));
  assert.notEqual(hashEmail("s1", "ann@example.com"), hashEmail("s2", "ann@example.com"));
  assert.ok(!hashEmail("s1", "ann@example.com").includes("ann"));
});

test("random tokens are unique and long enough", () => {
  assert.notEqual(randomToken(), randomToken());
  assert.ok(randomToken().length >= 43);
  assert.equal(sha256Hex("a").length, 64);
});

// Signature built independently of the implementation using the documented algorithm.
function proxyQuery(secret: string, params: Record<string, string>) {
  const message = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("");
  const signature = createHmac("sha256", secret).update(message).digest("hex");
  return new URLSearchParams({ ...params, signature });
}
const ts = String(Math.floor(now.getTime() / 1000));

test("app proxy: accepts a valid signature", () => {
  const q = proxyQuery("sec", { shop: "a.myshopify.com", path_prefix: "/apps/reviews", timestamp: ts, product_id: "1" });
  assert.equal(verifyAppProxySignature(q, "sec", now), true);
});

test("app proxy: rejects tampered params, wrong secret, missing signature and stale timestamps", () => {
  const q = proxyQuery("sec", { shop: "a.myshopify.com", timestamp: ts, product_id: "1" });
  const tampered = new URLSearchParams(q); tampered.set("shop", "evil.myshopify.com");
  assert.equal(verifyAppProxySignature(tampered, "sec", now), false);
  assert.equal(verifyAppProxySignature(q, "wrong", now), false);
  const noSig = new URLSearchParams(q); noSig.delete("signature");
  assert.equal(verifyAppProxySignature(noSig, "sec", now), false);
  assert.equal(verifyAppProxySignature(q, "sec", new Date(now.getTime() + 3_600_000)), false);
  assert.equal(verifyAppProxySignature(q, "", now), false);
});

test("app proxy: repeated parameters are joined with commas as documented", () => {
  const secret = "sec";
  const message = `extra=1,2shop=a.myshopify.comtimestamp=${ts}`;
  const signature = createHmac("sha256", secret).update(message).digest("hex");
  const q = new URLSearchParams(`extra=1&extra=2&shop=a.myshopify.com&timestamp=${ts}&signature=${signature}`);
  assert.equal(verifyAppProxySignature(q, secret, now), true);
});

test("rate limiter blocks after the limit, isolates keys and resets after the window", () => {
  let t = 0;
  const rl = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
  assert.equal(rl.check("a").allowed, true);
  assert.equal(rl.check("a").allowed, true);
  const blocked = rl.check("a");
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);
  assert.equal(rl.check("b").allowed, true);
  t = 1001;
  assert.equal(rl.check("a").allowed, true);
});
