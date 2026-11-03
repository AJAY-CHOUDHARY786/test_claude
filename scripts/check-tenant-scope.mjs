#!/usr/bin/env node
// Tenant-isolation check. Finds every Prisma call on a merchant-owned model and requires `shopId` in its first argument.
// Also flags raw SQL. Exceptions must be listed in TENANT_ALLOWLIST with a reason, and stale entries fail the check.
// Usage: node scripts/check-tenant-scope.mjs   (needs the `typescript` package, which is a devDependency)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let ts;
try { ts = require("typescript"); } catch { ts = require(process.env.TYPESCRIPT_PATH ?? "typescript"); }

/** Delegates for models that carry shopId (the Prisma client uses the camelCase model name). */
export const TENANT_MODELS = new Set(["shopSettings", "subscription", "review", "reviewMedia", "reviewReply", "moderationEvent", "reviewRequest", "emailTemplate", "suppression", "question", "answer", "importJob", "job", "usageStat", "auditLog", "productWidgetSetting"]);
const METHODS = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy", "create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
const RAW = new Set(["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"]);

/** file (relative, forward slashes) + optional model. Every entry needs a reason a reviewer can judge. */
export const TENANT_ALLOWLIST = [
  { file: "app/routes/healthz.tsx", reason: "Health check runs SELECT 1 and touches no merchant data." },
  { file: "app/jobs/worker.server.ts", reason: "Background worker: processes rows claimed from the global queue by id, and runs retention purges across all shops by design. Every per-shop side effect reads shopId from the claimed row." },
  { file: "app/services/email-events.server.ts", model: "reviewRequest", reason: "Looks a request up by the email provider's message ID (unique per sent email); every later write is scoped by the found row's shopId." },
  { file: "app/routes/r.$token.tsx", model: "reviewRequest", reason: "Looks the request up by an HMAC-signed, expiring token that only the recipient has; shopId then comes from the found row." },
];

/** Which argument properties must carry shopId for each Prisma method. */
const REQUIRED = {
  create: ["data"], createMany: ["data"], upsert: ["where", "create"],
};
const requiredFor = (method) => REQUIRED[method] ?? ["where"];

export function scanSource(text, file) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  // Local `const x = ...` declarations, so `where` built earlier in the function can be inspected.
  const declarations = new Map();
  const collect = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) declarations.set(n.name.text, n.initializer.getText(sf));
    ts.forEachChild(n, collect);
  };
  collect(sf);

  const hasShopId = (expr) => {
    if (/\bshopId/.test(expr.getText(sf))) return true;
    // Only a bare identifier is resolved (`{ where }` or `where: filter`) to a local initializer that mentions shopId.
    // Nested identifiers do not count, so `where: { id: someVar }` cannot pass by accident.
    return ts.isIdentifier(expr) && declarations.has(expr.text) && /\bshopId/.test(declarations.get(expr.text));
  };

  const propertyValue = (obj, key) => {
    for (const p of obj.properties) {
      if (ts.isShorthandPropertyAssignment(p) && p.name.text === key) return p.name;
      if (ts.isPropertyAssignment(p) && p.name.getText(sf) === key) return p.initializer;
    }
    return null;
  };

  const found = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const callee = node.expression;
      const name = callee.name.text;
      const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      if (RAW.has(name)) found.push({ file, line, kind: "raw", model: null, method: name });
      else if (METHODS.has(name) && ts.isPropertyAccessExpression(callee.expression) && TENANT_MODELS.has(callee.expression.name.text)) {
        const arg = node.arguments[0];
        let ok = Boolean(arg) && ts.isObjectLiteralExpression(arg);
        if (ok) for (const key of requiredFor(name)) { const v = propertyValue(arg, key); if (!v || !hasShopId(v)) ok = false; }
        if (!ok) found.push({ file, line, kind: "unscoped", model: callee.expression.name.text, method: name });
      }
    }
    // Raw SQL written as a tagged template, e.g. prisma.$queryRaw`SELECT 1`
    if (ts.isTaggedTemplateExpression(node) && ts.isPropertyAccessExpression(node.tag) && RAW.has(node.tag.name.text)) {
      found.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, kind: "raw", model: null, method: node.tag.name.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(p)) yield p;
  }
}

export function checkProject(root = ".") {
  const all = [];
  for (const f of walk(join(root, "app"))) all.push(...scanSource(readFileSync(f, "utf8"), relative(root, f).split("\\").join("/")));
  const used = new Set();
  const violations = all.filter((v) => {
    const idx = TENANT_ALLOWLIST.findIndex((a) => a.file === v.file && (!a.model || a.model === v.model));
    if (idx >= 0) { used.add(idx); return false; }
    return true;
  });
  const stale = TENANT_ALLOWLIST.filter((_, i) => !used.has(i));
  return { violations, stale, scannedCalls: all.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { violations, stale } = checkProject();
  for (const v of violations) console.error(`${v.kind === "raw" ? "RAW SQL" : "UNSCOPED"}  ${v.file}:${v.line}  ${v.model ? `${v.model}.` : ""}${v.method}`);
  for (const s of stale) console.error(`STALE ALLOWLIST ENTRY  ${s.file}${s.model ? ` (${s.model})` : ""}`);
  if (violations.length || stale.length) process.exit(1);
  console.log("Tenant scope check passed: every query on merchant-owned data includes shopId (or is allowlisted with a reason).");
}
