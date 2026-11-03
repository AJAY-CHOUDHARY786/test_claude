#!/usr/bin/env node
// Offline structure check of prisma/schema.prisma: relation targets exist, back-relations are paired,
// foreign-key fields exist, every model has an id, and every tenant table cascades from Shop.
// Not a replacement for `npx prisma validate`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SCALARS = new Set(["String", "Boolean", "Int", "BigInt", "Float", "DateTime", "Json", "Decimal", "Bytes"]);

export function checkSchema(src) {
  const enums = new Set([...src.matchAll(/^enum\s+(\w+)/gm)].map((m) => m[1]));
  const models = {};
  for (const m of src.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const fields = {};
    for (const raw of m[2].split("\n")) {
      const line = raw.split("//")[0].trim();
      if (!line || line.startsWith("@@")) continue;
      const parts = line.split(/\s+/);
      if (parts.length >= 2) fields[parts[0]] = { type: parts[1], line };
    }
    models[m[1]] = fields;
  }
  const errors = [];
  const base = (t) => t.replace(/[?\[\]]/g, "");
  for (const [name, fields] of Object.entries(models)) {
    if (!Object.values(fields).some((f) => f.line.includes("@id"))) errors.push(`${name}: no @id`);
    for (const [fname, { type, line }] of Object.entries(fields)) {
      const b = base(type);
      if (SCALARS.has(b) || enums.has(b)) continue;
      if (!models[b]) { errors.push(`${name}.${fname}: unknown type ${b}`); continue; }
      const rel = line.match(/@relation\(fields:\s*\[(\w+)\],\s*references:\s*\[(\w+)\]/);
      if (rel) {
        const [, fk, ref] = rel;
        if (!fields[fk]) errors.push(`${name}.${fname}: FK field ${fk} missing`);
        if (!models[b][ref]) errors.push(`${name}.${fname}: referenced field ${b}.${ref} missing`);
        const back = Object.values(models[b]).some((f) => base(f.type) === name && !f.line.includes("@relation"));
        if (!back) errors.push(`${name}.${fname}: no back-relation on ${b}`);
      } else {
        const owner = Object.values(models[b]).some((f) => base(f.type) === name && f.line.includes("@relation(fields"));
        if (!owner) errors.push(`${name}.${fname}: no owning relation on ${b}`);
      }
    }
    if (fields.shopId && name !== "Shop" && !(fields.shop && fields.shop.line.includes("onDelete: Cascade"))) {
      errors.push(`${name}: shopId without a cascading Shop relation`);
    }
  }
  return { models: Object.keys(models).length, enums: enums.size, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { models, enums, errors } = checkSchema(readFileSync(process.argv[2] ?? "prisma/schema.prisma", "utf8"));
  console.log(`${models} models, ${enums} enums checked`);
  if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
  console.log("Schema structure OK");
}
