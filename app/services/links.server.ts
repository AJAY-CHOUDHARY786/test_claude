import { env } from "../config.server.ts";
import { hashEmail, signPayload, sha256Hex, verifySignedPayload } from "../lib/tokens.ts";

// Separate signing keys per purpose, derived from the app secret, so one kind of token can never be used as another.
const key = (purpose: string) => sha256Hex(`${env.shopifyApiSecret}:${purpose}`);
const days = (n: number) => new Date(Date.now() + n * 86_400_000);

export const reviewToken = (requestId: string) => signPayload(key("review"), { r: requestId }, days(90));
export const reviewLink = (requestId: string) => `${env.appUrl}/r/${reviewToken(requestId)}`;
export const readReviewToken = (t: string) => { const p = verifySignedPayload(key("review"), t, new Date()); return typeof p?.r === "string" ? p.r : null; };

export const unsubscribeLink = (shopId: string, email: string) => `${env.appUrl}/unsubscribe?t=${signPayload(key("unsub"), { s: shopId, e: email.toLowerCase(), h: hashEmail(shopId, email) }, days(365))}`;
export const readUnsubscribeToken = (t: string) => {
  const p = verifySignedPayload(key("unsub"), t, new Date());
  return p && typeof p.s === "string" && typeof p.e === "string" ? { shopId: p.s, email: p.e } : null;
};

/** Short-lived permission to attach photos to one specific review just submitted from the storefront. */
export const uploadToken = (reviewId: string, shopId: string) => signPayload(key("upload"), { v: reviewId, s: shopId }, new Date(Date.now() + 15 * 60_000));
export const readUploadToken = (t: string) => {
  const p = verifySignedPayload(key("upload"), t, new Date());
  return p && typeof p.v === "string" && typeof p.s === "string" ? { reviewId: p.v, shopId: p.s } : null;
};

/** A shareable "write a review for this product" link (social posts, packaging inserts). Reviews from it are never "verified". */
export const collectLink = (shopId: string, productId: string) => `${env.appUrl}/c/${signPayload(key("collect"), { s: shopId, p: productId }, new Date(Date.now() + 3650 * 86_400_000))}`;
export const readCollectToken = (t: string) => {
  const p = verifySignedPayload(key("collect"), t, new Date());
  return p && typeof p.s === "string" && typeof p.p === "string" && /^\d{1,20}$/.test(p.p) ? { shopId: p.s, productId: p.p } : null;
};
