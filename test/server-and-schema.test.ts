import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-expect-error plain JS modules have no type declarations
import { clientIpMiddleware, securityHeaders } from "../server/middleware.js";
// @ts-expect-error plain .mjs scripts have no type declarations
import { checkSchema } from "../scripts/check-prisma-schema.mjs";

test("Express middleware overwrites a spoofed X-Client-IP with the trusted req.ip", () => {
  const req = { ip: "198.51.100.7", headers: { "x-client-ip": "1.2.3.4" } as Record<string, string> };
  let called = false;
  clientIpMiddleware(req, {}, () => { called = true; });
  assert.equal(req.headers["x-client-ip"], "198.51.100.7");
  assert.ok(called);
  const noIp = { headers: {} as Record<string, string> };
  clientIpMiddleware(noIp, {}, () => {});
  assert.equal(noIp.headers["x-client-ip"], "unknown");
});

test("security headers are set without blocking embedding in the Shopify admin", () => {
  const set: Record<string, string> = {};
  securityHeaders({}, { setHeader: (k: string, v: string) => { set[k.toLowerCase()] = v; } }, () => {});
  assert.equal(set["x-content-type-options"], "nosniff");
  assert.ok(set["referrer-policy"]);
  assert.equal(set["x-frame-options"], undefined);
  assert.equal(set["content-security-policy"], undefined);
});

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");

test("the real Prisma schema is structurally sound", () => {
  const r = checkSchema(schema);
  assert.deepEqual(r.errors, []);
  assert.ok(r.models >= 19);
});

test("the schema checker catches a missing back-relation, a bad foreign key and a non-cascading tenant table", () => {
  assert.ok(checkSchema(schema.replace("  reviews        Review[]\n", "")).errors.length > 0);
  assert.ok(checkSchema(schema.replace("fields: [shopId], references: [id], onDelete: Cascade", "fields: [nope], references: [id], onDelete: Cascade")).errors.length > 0);
  assert.ok(checkSchema(schema.replace("onDelete: Cascade", "onDelete: SetNull")).errors.length > 0);
});

test("every merchant-owned model has a shopId and cascades from Shop", () => {
  const names = [...schema.matchAll(/^model\s+(\w+)/gm)].map((m) => m[1]);
  const tenantless = ["Session", "Shop", "WebhookEvent", "PrivacyEvent"];
  for (const n of names) {
    if (tenantless.includes(n!)) continue;
    const body = schema.match(new RegExp(`^model ${n} \\{([\\s\\S]*?)^\\}`, "m"))![1]!;
    assert.match(body, /\n\s+shopId\s+String/, `${n} needs shopId`);
  }
});
