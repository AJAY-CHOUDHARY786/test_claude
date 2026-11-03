import { test } from "node:test";
import assert from "node:assert/strict";
import { detectImageType, validateImageUpload, MAX_IMAGE_BYTES } from "../app/lib/media.ts";

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const enc = (s: string) => new TextEncoder().encode(s);

test("detects supported image types from content", () => {
  assert.equal(detectImageType(png)?.ext, "png");
  assert.equal(detectImageType(jpg)?.ext, "jpg");
  assert.equal(detectImageType(gif)?.ext, "gif");
  assert.equal(detectImageType(webp)?.ext, "webp");
});

test("rejects SVG, HTML, scripts, executables and unknown data even if the name says image", () => {
  for (const evil of [enc('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), enc("<html><script>1</script>"), enc("#!/bin/sh\nrm -rf /"), Uint8Array.from([0x4d, 0x5a, 0x90, 0]), Uint8Array.from([0x7f, 0x45, 0x4c, 0x46])]) {
    assert.equal(detectImageType(evil), null);
    assert.equal(validateImageUpload(evil, "shop1", "image/png").ok, false);
  }
});

test("rejects empty, oversized and mismatched-type uploads", () => {
  assert.equal(validateImageUpload(new Uint8Array(0), "shop1").ok, false);
  const big = new Uint8Array(MAX_IMAGE_BYTES + 1); big.set(png);
  assert.equal(validateImageUpload(big, "shop1").ok, false);
  assert.equal(validateImageUpload(png, "shop1", "image/jpeg").ok, false);
});

test("accepted uploads get a generated key inside the shop folder and a safe extension", () => {
  const a = validateImageUpload(png, "shop1", "image/png");
  const b = validateImageUpload(png, "shop1", "image/png");
  assert.ok(a.ok && b.ok);
  if (a.ok && b.ok) {
    assert.match(a.storageKey, /^reviews\/shop1\/[0-9a-f-]{36}\.png$/);
    assert.notEqual(a.storageKey, b.storageKey);
  }
});

test("rejects shop IDs that could escape the folder", () => {
  assert.equal(validateImageUpload(png, "../other").ok, false);
});
