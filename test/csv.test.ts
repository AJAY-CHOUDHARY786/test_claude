import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, toCsv, neutralizeFormula, validateImportRows, normalizeProductId, CsvError, MAX_CSV_BYTES } from "../app/lib/csv.ts";

const now = new Date("2026-06-15T00:00:00Z");

test("parses quotes, commas, escaped quotes, newlines in fields and CRLF", () => {
  const rows = parseCsv('a,b,c\r\n1,"x, y","say ""hi"""\r\n"multi\nline",2,3\r\n');
  assert.deepEqual(rows, [["a", "b", "c"], ["1", "x, y", 'say "hi"'], ["multi\nline", "2", "3"]]);
});

test("strips a BOM and ignores blank lines", () => {
  assert.deepEqual(parseCsv("\uFEFFa,b\n\n1,2\n"), [["a", "b"], ["1", "2"]]);
});

test("rejects unterminated quotes and oversized input", () => {
  assert.throws(() => parseCsv('a,b\n"oops,1'), CsvError);
  assert.throws(() => parseCsv("x".repeat(MAX_CSV_BYTES + 1)), CsvError);
});

test("export neutralizes formula injection in every dangerous form", () => {
  for (const evil of ["=1+1", "+cmd|' /C calc'!A0", "-2+3", "@SUM(A1)", "\t=1", "\r=1"]) {
    assert.ok(neutralizeFormula(evil).startsWith("'"), JSON.stringify(evil));
  }
  assert.equal(neutralizeFormula("Great product"), "Great product");
  const csv = toCsv([["id", "body"], ["1", "=HYPERLINK(\"http://evil\")"]]);
  // Expected: leading apostrophe added, then the field quoted with inner quotes doubled.
  assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"")"`));
  assert.ok(!csv.includes(",=HYPERLINK"));
});

test("export quotes fields and keeps numbers and booleans as-is", () => {
  assert.equal(toCsv([["a,b", 5, true, null]]), '"a,b",5,true,\r\n');
});

test("round trip: exported then parsed rows match the original data", () => {
  const original = [["id", "body"], ["1", 'He said "wow", then\nleft']];
  assert.deepEqual(parseCsv(toCsv(original)), original);
});

test("normalizes product IDs from numbers and GIDs only", () => {
  assert.equal(normalizeProductId("123"), "123");
  assert.equal(normalizeProductId("gid://shopify/Product/456"), "456");
  assert.equal(normalizeProductId("abc"), null);
  assert.equal(normalizeProductId("gid://shopify/Order/1"), null);
});

const header = "product_id,rating,title,body,reviewer_name,status,created_at,reply";
test("validates rows, reports line numbers for errors and keeps good rows", () => {
  const rows = parseCsv([
    header,
    "1,5,Great,Loved it,Ann,published,2026-01-01,Thanks!",
    "x,5,,Bad id,Bob,,,",
    "2,9,,Bad rating,Cy,,,",
    "3,4,,,Dee,,,",
    "4,4,,Fine,Eve,weird,,",
    "5,3,,Later,Fay,,2999-01-01,",
  ].join("\n"));
  const r = validateImportRows(rows, now);
  assert.equal(r.valid.length, 1);
  assert.equal(r.valid[0]!.status, "PUBLISHED");
  assert.equal(r.valid[0]!.reply, "Thanks!");
  assert.deepEqual(r.errors.map((e) => e.line), [3, 4, 5, 6, 7]);
});

test("flags duplicates inside the file and creates stable external keys", () => {
  const rows = parseCsv([header, "1,5,,Same,Ann,,,", "1,5,,Same,Ann,,,"].join("\n"));
  const r = validateImportRows(rows, now);
  assert.equal(r.valid.length, 1);
  assert.equal(r.duplicatesInFile, 1);
  const again = validateImportRows(parseCsv([header, "1,5,,Same,Ann,,,"].join("\n")), now);
  assert.equal(again.valid[0]!.externalKey, r.valid[0]!.externalKey);
});

test("rejects files missing required columns or empty", () => {
  assert.equal(validateImportRows(parseCsv("product_id,title\n1,x"), now).errors[0]!.message.includes("rating"), true);
  assert.equal(validateImportRows([], now).valid.length, 0);
});

test("imported formulas stay as plain text (never executed) and control characters are removed", () => {
  const r = validateImportRows(parseCsv(`${header}\n1,5,,"=1+1\u0007",Ann,,,`), now);
  assert.equal(r.valid[0]!.body, "=1+1");
});
