/** Upload validation based on file contents (magic bytes), never on the filename or declared type alone. */
import { randomUUID } from "node:crypto";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_REVIEW = 5;
export interface DetectedImage { mime: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; ext: "jpg" | "png" | "webp" | "gif" }

const startsWith = (b: Uint8Array, sig: number[], off = 0) => sig.every((v, i) => b[off + i] === v);

export function detectImageType(b: Uint8Array): DetectedImage | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg" };
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: "png" };
  if (startsWith(b, [0x47, 0x49, 0x46, 0x38]) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return { mime: "image/gif", ext: "gif" };
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return { mime: "image/webp", ext: "webp" };
  return null;
}

export type UploadCheck =
  | { ok: true; image: DetectedImage; storageKey: string }
  | { ok: false; error: string };

export function validateImageUpload(bytes: Uint8Array, shopId: string, declaredMime?: string): UploadCheck {
  if (bytes.byteLength === 0) return { ok: false, error: "The file is empty" };
  if (bytes.byteLength > MAX_IMAGE_BYTES) return { ok: false, error: "Images must be 5 MB or smaller" };
  const image = detectImageType(bytes);
  if (!image) return { ok: false, error: "Only JPEG, PNG, WebP and GIF images are allowed" };
  if (declaredMime && declaredMime.toLowerCase() !== image.mime) return { ok: false, error: "The file type does not match its contents" };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(shopId)) return { ok: false, error: "Invalid shop" };
  // Generated name: the uploaded filename is never used.
  return { ok: true, image, storageKey: `reviews/${shopId}/${randomUUID()}.${image.ext}` };
}
