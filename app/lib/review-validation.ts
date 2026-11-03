/** Validation and sanitization for customer-submitted reviews. Output must still be escaped when rendered. */
export interface ReviewSubmission {
  productId: string; rating: number; title: string | null; body: string; reviewerName: string;
}
export type ValidationResult =
  | { ok: true; value: ReviewSubmission }
  | { ok: false; bot: boolean; errors: Record<string, string> };

export function sanitizeText(input: string, max: number): string {
  return input
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

export function validateReviewSubmission(raw: Record<string, unknown>): ValidationResult {
  // Honeypot field: real shoppers never see or fill it.
  if (str(raw.website).trim() !== "") return { ok: false, bot: true, errors: {} };
  const errors: Record<string, string> = {};
  const productId = str(raw.productId).trim();
  if (!/^\d{1,20}$/.test(productId)) errors.productId = "Product is missing or invalid";
  const rating = Number(str(raw.rating));
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.rating = "Choose a rating from 1 to 5 stars";
  const body = sanitizeText(str(raw.body), 5000);
  if (body.length < 3) errors.body = "Write at least a few words about the product";
  const reviewerName = sanitizeText(str(raw.name), 60);
  if (!reviewerName) errors.name = "Enter the name to show with your review";
  const title = sanitizeText(str(raw.title), 120) || null;
  if (Object.keys(errors).length) return { ok: false, bot: false, errors };
  return { ok: true, value: { productId, rating, title, body, reviewerName } };
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
