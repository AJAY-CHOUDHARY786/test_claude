/** CSV parsing, writing and review-import validation. Never evaluates content; neutralizes spreadsheet formulas on export. */
import { createHash } from "node:crypto";

export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_ROWS = 20_000;

export class CsvError extends Error {
  constructor(message: string) { super(message); this.name = "CsvError"; }
}

export function parseCsv(input: string): string[][] {
  if (input.length > MAX_CSV_BYTES) throw new CsvError("File is too large");
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const endRow = () => {
    row.push(field); field = "";
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
    if (rows.length > MAX_CSV_ROWS + 1) throw new CsvError("Too many rows");
  };
  while (i < text.length) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === "") { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { if (text[i + 1] === "\n") i++; endRow(); i++; continue; }
    if (c === "\n") { endRow(); i++; continue; }
    field += c; i++;
  }
  if (inQuotes) throw new CsvError("Unterminated quoted field");
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/** Prefix cells that spreadsheet apps could run as formulas. */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export type CsvCell = string | number | boolean | null | undefined;

export function toCsv(rows: CsvCell[][]): string {
  const cell = (v: CsvCell): string => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "string" ? neutralizeFormula(v) : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export interface ImportRow {
  productId: string;
  rating: number;
  title: string | null;
  body: string;
  reviewerName: string;
  status: "PUBLISHED" | "PENDING" | "HIDDEN";
  createdAt: Date | null;
  reply: string | null;
  externalKey: string;
}
export interface ImportRowError { line: number; message: string }
export interface ImportResult { valid: ImportRow[]; errors: ImportRowError[]; duplicatesInFile: number; total: number }

const REQUIRED = ["product_id", "rating", "body"];
const STATUS_MAP: Record<string, ImportRow["status"]> = {
  published: "PUBLISHED", approved: "PUBLISHED", pending: "PENDING", hidden: "HIDDEN", rejected: "HIDDEN",
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s-]+/g, "_");
}
export function normalizeProductId(raw: string): string | null {
  const v = raw.trim();
  const m = /^gid:\/\/shopify\/Product\/(\d{1,20})$/.exec(v) ?? /^(\d{1,20})$/.exec(v);
  return m ? m[1]! : null;
}
function clean(s: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return s.normalize("NFC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
}
export function importKey(r: { productId: string; reviewerName: string; body: string; createdAt: Date | null }): string {
  return createHash("sha256")
    .update([r.productId, r.reviewerName.toLowerCase(), r.body.toLowerCase(), r.createdAt?.toISOString() ?? ""].join("\u0001"))
    .digest("hex");
}

export function validateImportRows(rows: string[][], now: Date): ImportResult {
  if (rows.length === 0) return { valid: [], errors: [{ line: 1, message: "The file is empty" }], duplicatesInFile: 0, total: 0 };
  const header = rows[0]!.map(normalizeHeader);
  const missing = REQUIRED.filter((h) => !header.includes(h));
  if (missing.length) {
    return { valid: [], errors: [{ line: 1, message: `Missing required column(s): ${missing.join(", ")}` }], duplicatesInFile: 0, total: rows.length - 1 };
  }
  const idx = (name: string) => header.indexOf(name);
  const get = (r: string[], name: string) => { const i = idx(name); return i >= 0 ? (r[i] ?? "") : ""; };

  const valid: ImportRow[] = [];
  const errors: ImportRowError[] = [];
  const seen = new Set<string>();
  let duplicatesInFile = 0;

  rows.slice(1).forEach((r, n) => {
    const line = n + 2;
    const productId = normalizeProductId(get(r, "product_id"));
    if (!productId) return void errors.push({ line, message: "product_id must be a numeric ID or Shopify product GID" });
    const rating = Number(get(r, "rating").trim());
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return void errors.push({ line, message: "rating must be a whole number from 1 to 5" });
    const body = clean(get(r, "body"), 5000);
    if (!body) return void errors.push({ line, message: "body is required" });
    const title = clean(get(r, "title"), 120) || null;
    const reviewerName = clean(get(r, "reviewer_name"), 60) || "Anonymous";
    const statusRaw = get(r, "status").trim().toLowerCase();
    if (statusRaw && !STATUS_MAP[statusRaw]) return void errors.push({ line, message: "status must be published, pending or hidden" });
    const status = STATUS_MAP[statusRaw] ?? "PENDING";
    let createdAt: Date | null = null;
    const dateRaw = get(r, "created_at").trim();
    if (dateRaw) {
      const d = new Date(dateRaw);
      if (Number.isNaN(d.getTime()) || d.getTime() > now.getTime() + 86_400_000) return void errors.push({ line, message: "created_at must be a valid past date" });
      createdAt = d;
    }
    const reply = clean(get(r, "reply"), 2000) || null;
    const externalKey = importKey({ productId, reviewerName, body, createdAt });
    if (seen.has(externalKey)) { duplicatesInFile++; return; }
    seen.add(externalKey);
    valid.push({ productId, rating, title, body, reviewerName, status, createdAt, reply, externalKey });
  });
  return { valid, errors, duplicatesInFile, total: rows.length - 1 };
}

export const EXPORT_HEADER = ["id", "product_id", "rating", "title", "body", "reviewer_name", "status", "verified_purchase", "created_at", "reply"];
