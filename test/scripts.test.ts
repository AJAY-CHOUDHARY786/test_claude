import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error plain .mjs scripts have no type declarations
import { convertToPostgres } from "../scripts/use-postgres.mjs";
// @ts-expect-error plain .mjs scripts have no type declarations
import { scanText } from "../scripts/check-secrets.mjs";

// Fake values are assembled at runtime so the repo secret scanner does not flag this file.
const FAKE_TOKEN = "shp" + "at_" + "0123456789abcdef0123456789";
const FAKE_DB_PASSWORD = "hunter" + "2pass";


// Representative sample of a SQLite datasource block. The real template file is not available offline.
const sqliteSchema = `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = "file:dev.sqlite"
}

model Session {
  id String @id
}
`;

test("use-postgres switches provider and url and leaves the rest alone", () => {
  const out = convertToPostgres(sqliteSchema);
  assert.ok(out.includes('provider = "postgresql"'));
  assert.ok(out.includes('url      = env("DATABASE_URL")'));
  assert.ok(!out.includes("sqlite"));
  assert.ok(out.includes('provider = "prisma-client-js"'));
  assert.ok(out.includes("model Session"));
});

test("use-postgres is idempotent", () => {
  const once = convertToPostgres(sqliteSchema);
  assert.equal(convertToPostgres(once), once);
});

test("use-postgres leaves a url-less datasource (Prisma 7 style) without adding one", () => {
  const out = convertToPostgres('datasource db {\n  provider = "sqlite"\n}\n');
  assert.ok(out.includes("postgresql"));
  assert.ok(!out.includes("url"));
});

test("use-postgres refuses a schema with no datasource", () => {
  assert.throws(() => convertToPostgres("model A { id Int @id }"));
});

test("secret scanner flags real-looking secrets", () => {
  assert.ok(scanText(`token = ${FAKE_TOKEN}`).length > 0);
  assert.ok(scanText(`postgresql://admin:${FAKE_DB_PASSWORD}@db.example.com/app`).length > 0);
  assert.ok(scanText(`-----BEGIN ${"PRIVATE"} KEY-----`).length > 0);
  assert.ok(scanText(`SHOPIFY_API_SECRET=${"x".repeat(32)}`).length > 0);
});

test("secret scanner ignores placeholders", () => {
  assert.deepEqual(scanText("DATABASE_URL=postgresql://USER:<password>@HOST:5432/DB"), []);
  assert.deepEqual(scanText("SHOPIFY_API_SECRET="), []);
  assert.deepEqual(scanText("postgresql://user:${DB_PASSWORD}@host/db"), []);
  assert.deepEqual(scanText("SHOPIFY_API_KEY=your_api_key_here"), []);
});

test("secret scanner honours an explicit per-line ignore marker but still flags other lines", () => {
  const fakeUrl = "postgresql://ci:" + "throwaway1" + "@localhost/db";
  assert.deepEqual(scanText(`DATABASE_URL: ${fakeUrl} # secret-scan:ignore fake`), []);
  assert.ok(scanText(`# secret-scan:ignore\nDATABASE_URL: ${fakeUrl}`).length > 0);
});
