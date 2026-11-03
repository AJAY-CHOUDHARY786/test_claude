#!/usr/bin/env node
// Phase 2 gate: runs every foundation check in order and writes phase2-report.txt (secrets masked).
// Usage: node scripts/verify-phase2.mjs            (needs internet for the install step)
//        node scripts/verify-phase2.mjs --skip-install
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Masks anything that looks like a secret before output is shown or saved. */
export function redactOutput(text) {
  return String(text)
    .replace(/\bshp(?:at|ca|ss|pa)_[A-Za-z0-9]{8,}\b/g, "[REDACTED]")
    .replace(/(postgres(?:ql)?:\/\/[^:\/\s@]+:)[^@\s]+(@)/gi, "$1[REDACTED]$2")
    .replace(/((?:API_SECRET|SECRET_KEY|ACCESS_TOKEN|RESEND_API_KEY|S3_SECRET_ACCESS_KEY)\s*[=:]\s*)\S+/g, "$1[REDACTED]");
}

export function nodeVersionOk(version) {
  const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
  return (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22;
}

export function envFileProblems(text) {
  const has = (k) => new RegExp(`^${k}=\\S+`, "m").test(text);
  return ["DATABASE_URL"].filter((k) => !has(k)).map((k) => `${k} is not set in .env`);
}

export function run(name, command, opts = {}) {
  const started = Date.now();
  const r = spawnSync(command, { shell: true, encoding: "utf8", timeout: opts.timeoutMs ?? 600_000, env: { ...process.env, ...(opts.env ?? {}) } });
  const out = redactOutput(`${r.stdout ?? ""}${r.stderr ?? ""}`).trim();
  return { name, ok: r.status === 0, seconds: Math.round((Date.now() - started) / 1000), tail: out.split("\n").slice(-25).join("\n") };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const skipInstall = process.argv.includes("--skip-install");
  const results = [];
  const record = (r) => { results.push(r); console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name} (${r.seconds}s)`); if (!r.ok) console.log(r.tail.split("\n").map((l) => "      " + l).join("\n")); };

  record({ name: `Node version ${process.version} is supported`, ok: nodeVersionOk(process.version), seconds: 0, tail: "Need Node 20.19+ or 22.12+" });
  const envText = existsSync(".env") ? readFileSync(".env", "utf8") : "";
  const envProblems = existsSync(".env") ? envFileProblems(envText) : [".env file is missing (copy .env.example)"];
  record({ name: ".env has DATABASE_URL", ok: envProblems.length === 0, seconds: 0, tail: envProblems.join("\n") });

  const dbUrl = (envText.match(/^DATABASE_URL=(\S+)/m) ?? [])[1] ?? "";
  const env = { DATABASE_URL: dbUrl || "postgresql://placeholder:placeholder@localhost:5432/placeholder" }; // secret-scan:ignore fake placeholder for prisma validate
  if (!skipInstall) record(run("npm install", "npm install --no-audit --no-fund"));
  record(run("prisma validate", "npx prisma validate", { env }));
  record(run("prisma generate", "npx prisma generate", { env }));
  record(run("schema structure check", "npm run check:schema"));
  record(run("unit tests", "npm test"));
  record(run("secret scan", "npm run check:secrets"));
  record(run("type-check", "npm run typecheck", { env }));
  record(run("lint", "npm run lint"));
  record(run("production build", "npm run build", { env: { ...env, SHOPIFY_API_KEY: "build-placeholder", SHOPIFY_API_SECRET: "build-placeholder-secret", SCOPES: "read_products,read_orders", SHOPIFY_APP_URL: "https://example.com" } })); // secret-scan:ignore fake placeholder for build

  const failed = results.filter((r) => !r.ok);
  const lines = [`Phase 2 report, ${new Date().toISOString()}`, `Result: ${failed.length ? `${failed.length} FAILED` : "ALL PASSED"}`, ""];
  for (const r of results) lines.push(`${r.ok ? "PASS" : "FAIL"}  ${r.name}`, ...(r.ok ? [] : [r.tail, ""]));
  lines.push("", "Manual checks still needed: `npm run dev` starts and installs on your dev store; /healthz returns status ok.");
  writeFileSync("phase2-report.txt", lines.join("\n") + "\n");
  console.log(`\n${failed.length ? `${failed.length} check(s) failed.` : "All automatic checks passed."} Report saved to phase2-report.txt (secrets masked).`);
  process.exit(failed.length ? 1 : 0);
}
