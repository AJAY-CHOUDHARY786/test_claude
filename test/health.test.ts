import { test } from "node:test";
import assert from "node:assert/strict";
import { checkHealth } from "../app/lib/health.server.ts";

const now = () => new Date("2026-01-01T00:00:00.000Z");

test("reports ok when the database answers", async () => {
  const r = await checkHealth({ pingDatabase: async () => {}, now });
  assert.deepEqual(r, { status: "ok", checks: { database: "ok" }, timestamp: "2026-01-01T00:00:00.000Z" });
});

test("reports degraded without leaking error detail when the database fails", async () => {
  const r = await checkHealth({ pingDatabase: async () => { throw new Error("password=secret host=internal"); }, now });
  assert.equal(r.status, "degraded");
  assert.equal(r.checks.database, "fail");
  assert.ok(!JSON.stringify(r).includes("secret"));
});

test("reports degraded when the database is too slow", async () => {
  const r = await checkHealth({ pingDatabase: () => new Promise(() => {}), timeoutMs: 20, now });
  assert.equal(r.status, "degraded");
});
