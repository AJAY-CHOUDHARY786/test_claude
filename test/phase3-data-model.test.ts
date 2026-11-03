import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
// @ts-expect-error plain .mjs scripts have no type declarations
import { scanSource, checkProject, TENANT_MODELS } from "../scripts/check-tenant-scope.mjs";
// @ts-expect-error plain .mjs modules have no type declarations
import { CONSTRAINTS, INDEXES, renderPostgresSql } from "../prisma/constraints.mjs";

/* ---------- tenant-scope scanner ---------- */
const scan = (code: string) => scanSource(code, "app/services/example.server.ts") as { kind: string; model: string | null; method: string }[];

test("scanner flags queries on merchant data that are not scoped by shopId", () => {
  assert.equal(scan(`prisma.review.findMany({ where: { status: "PENDING" } })`).length, 1);
  assert.equal(scan(`prisma.review.findFirst({ where: { id } })`).length, 1);
  assert.equal(scan(`prisma.review.deleteMany({ where: { id: { in: ids } } })`).length, 1);
  assert.equal(scan(`prisma.review.count()`).length, 1);
  assert.equal(scan(`prisma.review.create({ data: { rating: 5 } })`).length, 1);
});

test("scanner accepts properly scoped queries", () => {
  assert.deepEqual(scan(`prisma.review.findMany({ where: { shopId, status: "PENDING" } })`), []);
  assert.deepEqual(scan(`tx.review.updateMany({ where: { id, shopId: shop.id }, data: { status: "HIDDEN" } })`), []);
  assert.deepEqual(scan(`prisma.review.create({ data: { shopId, rating: 5 } })`), []);
  assert.deepEqual(scan(`prisma.usageStat.upsert({ where: { shopId_day: { shopId, day } }, create: { shopId, day }, update: {} })`), []);
});

test("scanner is not fooled by shopId appearing only in select, include or nested variables", () => {
  assert.equal(scan(`prisma.reviewRequest.findFirst({ where: { providerMessageId: x }, select: { shopId: true } })`).length, 1);
  assert.equal(scan(`const owner = { shopId }; prisma.review.findMany({ where: { id: owner.id } })`).length, 1);
  assert.equal(scan(`prisma.reviewReply.upsert({ where: { reviewId: id }, create: { shopId, reviewId: id }, update: {} })`).length, 1);
});

test("scanner follows a bare local where variable that includes shopId, and nothing else", () => {
  assert.deepEqual(scan(`const where = { shopId, status }; prisma.review.findMany({ where })`), []);
  assert.deepEqual(scan(`const w = whereFor(shopId, f); prisma.review.count({ where: w })`), []);
  assert.equal(scan(`const where = { status }; prisma.review.findMany({ where })`).length, 1);
});

test("scanner flags raw SQL and ignores models that are not merchant-owned", () => {
  assert.equal(scan("prisma.$queryRaw`SELECT 1`").filter((v) => v.kind === "raw").length, 1);
  assert.deepEqual(scan(`prisma.shop.findUnique({ where: { domain } })`), []);
  assert.deepEqual(scan(`prisma.webhookEvent.create({ data: { id } })`), []);
});

test("every merchant-owned model in the schema is covered by the scanner's model list", () => {
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const owned = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].filter((m) => /\n\s+shopId\s+String/.test(m[2]!)).map((m) => m[1]!.charAt(0).toLowerCase() + m[1]!.slice(1));
  for (const m of owned) assert.ok(TENANT_MODELS.has(m), `${m} has shopId but is not in TENANT_MODELS`);
  for (const m of TENANT_MODELS) assert.ok(owned.includes(m), `${m} is in TENANT_MODELS but has no shopId in the schema`);
});

test("REAL CODE: every database query on merchant data in this project is scoped by shopId", () => {
  const { violations, stale, scannedCalls } = checkProject(new URL("..", import.meta.url).pathname);
  assert.deepEqual(violations.map((v: { file: string; line: number; method: string }) => `${v.file}:${v.line} ${v.method}`), []);
  assert.deepEqual(stale, []);
  assert.ok(scannedCalls >= 1);
});

/* ---------- database constraints, executed on SQLite ---------- */
const schemaSrc = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const enums = new Set([...schemaSrc.matchAll(/^enum\s+(\w+)/gm)].map((m) => m[1]!));
const modelNames = new Set([...schemaSrc.matchAll(/^model\s+(\w+)/gm)].map((m) => m[1]!));
const SQLITE: Record<string, string> = { String: "TEXT", Int: "INTEGER", BigInt: "INTEGER", Boolean: "INTEGER", DateTime: "TEXT", Json: "TEXT", Float: "REAL" };

interface Col { name: string; sql: string; default?: string | number | boolean }
function parseModels() {
  const models: Record<string, Col[]> = {};
  for (const m of schemaSrc.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const cols: Col[] = [];
    for (const raw of m[2]!.split("\n")) {
      const line = raw.split("//")[0]!.trim();
      if (!line || line.startsWith("@@")) continue;
      const [name, type] = line.split(/\s+/);
      if (!name || !type || type.endsWith("[]")) continue;
      const base = type.replace("?", "");
      if (modelNames.has(base)) continue; // relation field, not a column
      const sql = enums.has(base) ? "TEXT" : SQLITE[base];
      if (!sql) continue;
      const d = line.match(/@default\(([^)]*)\)/)?.[1];
      let def: Col["default"];
      if (d !== undefined) {
        if (/^-?\d+$/.test(d)) def = Number(d);
        else if (d === "true" || d === "false") def = d === "true";
        else if (/^"[^"]*"$/.test(d)) def = d.slice(1, -1);
      }
      cols.push({ name, sql, default: def });
    }
    models[m[1]!] = cols;
  }
  return models;
}
const MODELS = parseModels();

function buildDb() {
  const db = new DatabaseSync(":memory:");
  for (const [table, cols] of Object.entries(MODELS)) {
    const checks = (CONSTRAINTS as { table: string; name: string; check: string }[]).filter((c) => c.table === table).map((c) => `CONSTRAINT "${c.name}" CHECK (${c.check})`);
    db.exec(`CREATE TABLE "${table}" (${[...cols.map((c) => `"${c.name}" ${c.sql}`), ...checks].join(", ")})`);
  }
  for (const i of INDEXES as { sql: string }[]) db.exec(i.sql);
  return db;
}
const insert = (db: DatabaseSync, table: string, row: Record<string, unknown>) => {
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...(row as Record<string, never>)[keys[0]!] === undefined ? [] : keys.map((k) => row[k] as never));
};

const HASH = "a".repeat(64);
const BASE: Record<string, Record<string, unknown>> = {
  Review: { id: "r", shopId: "s", shopifyProductId: "1", rating: 5, body: "Great", reviewerName: "Ann", source: "STOREFRONT", status: "PENDING" },
  ReviewMedia: { id: "m", shopId: "s", reviewId: "r", storageKey: "k", mime: "image/png", sizeBytes: 1000 },
  ReviewReply: { id: "p", shopId: "s", reviewId: "r", body: "Thanks" },
  Question: { id: "q", shopId: "s", shopifyProductId: "1", body: "Fits?", askerName: "Al" },
  Answer: { id: "a", shopId: "s", questionId: "q", body: "Yes" },
  ShopSettings: { id: "ss", shopId: "s", reviewsPerPage: 10, requestDelayDays: 7, maxProductsPerOrder: 3, reminderDelayDays: 7, widgetLayout: "list", widgetAccentColor: "#1f4b3f" },
  ReviewRequest: { id: "rq", shopId: "s", kind: "REQUEST", attempts: 0 },
  EmailTemplate: { id: "et", shopId: "s", kind: "REQUEST", subject: "Hi", body: "{{review_link}}" },
  Suppression: { id: "su", shopId: "s", emailHash: HASH },
  Subscription: { id: "sb", shopId: "s", plan: "basic" },
  UsageStat: { id: "u", shopId: "s", reviewsCreated: 1, requestsSent: 0, photosStored: 0 },
  ProductWidgetSetting: { id: "pw", shopId: "s", shopifyProductId: "1", layout: "grid", accentColor: "#112233" },
};
/** For every constraint: a change that must make a valid row invalid. */
const VIOLATION: Record<string, Record<string, unknown>> = {
  review_rating_range: { rating: 6 }, review_body_length: { body: "" }, review_title_length: { title: "x".repeat(121) },
  review_name_length: { reviewerName: "" }, review_source_known: { source: "HACK" },
  media_size_range: { sizeBytes: 5_242_881 }, reply_body_length: { body: "x".repeat(2001) },
  question_body_length: { body: "x".repeat(1001) }, question_name_length: { askerName: "" }, answer_body_length: { body: "" },
  settings_per_page_range: { reviewsPerPage: 4 }, settings_request_delay_range: { requestDelayDays: 91 },
  settings_products_per_order_range: { maxProductsPerOrder: 0 }, settings_reminder_delay_range: { reminderDelayDays: 2 },
  settings_layout_known: { widgetLayout: "carousel" }, settings_accent_shape: { widgetAccentColor: "red" },
  request_attempts_nonnegative: { attempts: -1 }, request_kind_known: { kind: "SPAM" },
  template_kind_known: { kind: "OTHER" }, template_subject_length: { subject: "" }, template_body_length: { body: "x".repeat(5001) },
  suppression_hash_length: { emailHash: "abc" }, subscription_plan_known: { plan: "enterprise" },
  usage_counts_nonnegative: { photosStored: -1 }, product_layout_known: { layout: "wall" }, product_accent_shape: { accentColor: "#12" },
};

test("every constraint has a violation example (so none is untested)", () => {
  const names = (CONSTRAINTS as { name: string }[]).map((c) => c.name);
  assert.deepEqual(names.filter((n) => !(n in VIOLATION)), []);
  assert.deepEqual(Object.keys(VIOLATION).filter((n) => !names.includes(n)), []);
});

test("valid rows are accepted for every constrained table", () => {
  const db = buildDb();
  for (const [table, row] of Object.entries(BASE)) assert.doesNotThrow(() => insert(db, table, row), table);
});

test("each constraint rejects its violating row, and the error names that exact constraint", () => {
  for (const c of CONSTRAINTS as { table: string; name: string }[]) {
    const db = buildDb();
    assert.throws(() => insert(db, c.table, { ...BASE[c.table], ...VIOLATION[c.name] }), (e: Error) => e.message.includes(c.name), c.name);
  }
});

test("boundary values are accepted", () => {
  const db = buildDb();
  insert(db, "Review", { ...BASE.Review, id: "a1", rating: 1 });
  insert(db, "Review", { ...BASE.Review, id: "a2", rating: 5, body: "x".repeat(5000), title: "t".repeat(120), reviewerName: "n".repeat(60) });
  insert(db, "ReviewMedia", { ...BASE.ReviewMedia, id: "m2", storageKey: "k2", sizeBytes: 5_242_880 });
  insert(db, "ShopSettings", { ...BASE.ShopSettings, id: "x1", reviewsPerPage: 5, requestDelayDays: 0, maxProductsPerOrder: 1, reminderDelayDays: 3 });
  insert(db, "ShopSettings", { ...BASE.ShopSettings, id: "x2", reviewsPerPage: 50, requestDelayDays: 90, maxProductsPerOrder: 10, reminderDelayDays: 30 });
  insert(db, "Subscription", { id: "sn", shopId: "s2" }); // no plan yet is allowed
  insert(db, "ProductWidgetSetting", { id: "pn", shopId: "s", shopifyProductId: "2" }); // all overrides optional
});

test("the schema's own defaults satisfy the constraints (the app can never create a row the database rejects)", () => {
  const db = buildDb();
  for (const table of ["ShopSettings", "ReviewRequest", "Subscription", "UsageStat", "Review"]) {
    const row: Record<string, unknown> = { id: `d-${table}`, shopId: "s" };
    for (const c of MODELS[table]!) if (c.default !== undefined) row[c.name] = typeof c.default === "boolean" ? Number(c.default) : c.default;
    if (table === "Review") Object.assign(row, { shopifyProductId: "1", rating: 4, body: "ok", reviewerName: "Ann" });
    assert.doesNotThrow(() => insert(db, table, row), `${table} defaults`);
  }
});

test("partial indexes are valid SQL and constraints.sql is up to date", () => {
  assert.ok((INDEXES as unknown[]).length >= 3);
  assert.equal(readFileSync(new URL("../prisma/constraints.sql", import.meta.url), "utf8"), renderPostgresSql());
  const sql = renderPostgresSql();
  assert.equal((sql.match(/ADD CONSTRAINT/g) ?? []).length, (CONSTRAINTS as unknown[]).length);
  assert.equal((sql.match(/DROP CONSTRAINT IF EXISTS/g) ?? []).length, (CONSTRAINTS as unknown[]).length);
});

test("every constrained table and column really exists in the Prisma schema", () => {
  for (const c of CONSTRAINTS as { table: string; check: string }[]) {
    assert.ok(MODELS[c.table], `table ${c.table}`);
    for (const col of [...c.check.matchAll(/"(\w+)"/g)].map((m) => m[1]!)) assert.ok(MODELS[c.table]!.some((x) => x.name === col), `${c.table}.${col}`);
  }
});

test("the data model document mentions every model in the schema", () => {
  const doc = readFileSync(new URL("../docs/DATA_MODEL.md", import.meta.url), "utf8");
  for (const name of modelNames) assert.ok(doc.includes(`\`${name}\``), `docs/DATA_MODEL.md does not describe ${name}`);
});
