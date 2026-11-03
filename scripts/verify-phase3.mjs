#!/usr/bin/env node
// Phase 3 gate: validates the schema, creates/applies migrations and constraints on a TEST database,
// and runs the tenant-isolation tests against real PostgreSQL. Writes phase3-report.txt (secrets masked).
// Needs DATABASE_URL_TEST in the environment or .env, pointing at an EMPTY database whose name contains "test".
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { run } from "./verify-phase2.mjs";

export function testDbProblem(url) {
  if (!url) return "DATABASE_URL_TEST is not set (in your environment or .env)";
  let name;
  try { name = new URL(url).pathname.slice(1); } catch { return "DATABASE_URL_TEST is not a valid URL"; }
  if (!/^postgres(ql)?:/i.test(url)) return "DATABASE_URL_TEST must be a PostgreSQL URL";
  if (!/test/i.test(name)) return "The database name must contain 'test' so a real database is never touched";
  return null;
}

export function hasMigrations(dir = "prisma/migrations") {
  return existsSync(dir) && readdirSync(dir).some((d) => existsSync(`${dir}/${d}/migration.sql`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const envFile = existsSync(".env") ? readFileSync(".env", "utf8") : "";
  const url = process.env.DATABASE_URL_TEST ?? (envFile.match(/^DATABASE_URL_TEST=(\S+)/m) ?? [])[1] ?? "";
  const results = [];
  const record = (r) => { results.push(r); console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name} (${r.seconds}s)`); if (!r.ok) console.log(r.tail.split("\n").map((l) => "      " + l).join("\n")); };

  const problem = testDbProblem(url);
  record({ name: "DATABASE_URL_TEST is set and safe", ok: !problem, seconds: 0, tail: problem ?? "" });
  if (!problem) {
    const env = { DATABASE_URL: url, DATABASE_URL_TEST: url };
    record(run("prisma validate", "npx prisma validate", { env }));
    record(run("schema structure check", "npm run check:schema"));
    record(run("tenant scope check (every query scoped by shopId)", "npm run check:tenant"));
    record(run("unit tests (constraints on SQLite, scanner)", "npm test"));
    record(hasMigrations() ? run("apply migrations", "npx prisma migrate deploy", { env }) : run("create first migration (commit prisma/migrations afterwards)", "npx prisma migrate dev --name init --skip-generate", { env }));
    record(run("migration status", "npx prisma migrate status", { env }));
    record(run("apply CHECK constraints and partial indexes", "npm run db:constraints", { env }));
    record(run("database tests: tenant isolation, uniqueness, cascade, constraints", "npm run test:db", { env }));
  }
  const failed = results.filter((r) => !r.ok);
  const lines = [`Phase 3 report, ${new Date().toISOString()}`, `Result: ${failed.length ? `${failed.length} FAILED` : "ALL PASSED"}`, ""];
  for (const r of results) lines.push(`${r.ok ? "PASS" : "FAIL"}  ${r.name}`, ...(r.ok ? [] : [r.tail, ""]));
  writeFileSync("phase3-report.txt", lines.join("\n") + "\n");
  console.log(`\n${failed.length ? `${failed.length} check(s) failed.` : "All Phase 3 checks passed."} Report saved to phase3-report.txt (secrets masked).`);
  process.exit(failed.length ? 1 : 0);
}
