#!/usr/bin/env node
// Scans files for likely secrets. Exit code 1 if anything is found. Values are never printed.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RULES = [
  { name: "Shopify access token", re: /\bshp(?:at|ca|ss|pa)_[A-Za-z0-9]{16,}\b/ },
  { name: "Database URL with password", re: /postgres(?:ql)?:\/\/[^:\/\s@]+:(?!password\b|PASSWORD\b|<|\$\{|\{\{)[^@\s]{3,}@/i },
  { name: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "Hard-coded API secret assignment", re: /(?:API_SECRET|SECRET_KEY|ACCESS_TOKEN)\s*[=:]\s*["']?[A-Za-z0-9_\-]{20,}/ },
];

// A line containing "secret-scan:ignore" is skipped. Use it only for obviously fake values (for example a throwaway CI database).
export function scanText(text) {
  const lines = text.split("\n").filter((l) => !l.includes("secret-scan:ignore")).join("\n");
  return RULES.filter((r) => r.re.test(lines)).map((r) => r.name);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" })
    .split("\n").filter(Boolean);
  let found = 0;
  for (const file of files) {
    let text;
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    for (const name of scanText(text)) { console.error(`POSSIBLE SECRET in ${file}: ${name}`); found++; }
  }
  if (found) process.exit(1);
  console.log(`No likely secrets found in ${files.length} files.`);
}
