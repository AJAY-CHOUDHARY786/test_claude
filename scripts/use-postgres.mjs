#!/usr/bin/env node
// Switches the template's Prisma datasource from SQLite to PostgreSQL.
// Usage: node scripts/use-postgres.mjs [path/to/schema.prisma]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function convertToPostgres(schema) {
  const block = /datasource\s+db\s*\{([^}]*)\}/;
  const match = schema.match(block);
  if (!match) throw new Error("No `datasource db` block found in schema.prisma");
  let body = match[1];
  if (!/provider\s*=/.test(body)) throw new Error("datasource block has no provider line");
  body = body.replace(/provider\s*=\s*"[^"]*"/, 'provider = "postgresql"');
  // Prisma 7+ keeps the URL in prisma.config.ts, so only rewrite a url line if one exists.
  if (/url\s*=/.test(body)) body = body.replace(/url\s*=\s*.*/, 'url      = env("DATABASE_URL")');
  return schema.replace(block, `datasource db {${body}}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = process.argv[2] ?? "prisma/schema.prisma";
  const before = readFileSync(path, "utf8");
  const after = convertToPostgres(before);
  if (after === before) console.log("Already using PostgreSQL. No changes made.");
  else {
    writeFileSync(path, after);
    console.log(`Updated ${path} to PostgreSQL.`);
    console.log("Next: delete the template's old SQLite migrations folder (prisma/migrations), then run `npx prisma migrate dev --name init`.");
  }
}
