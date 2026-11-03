/** Random tokens, hashing and signed expiring payloads (used for unsubscribe links and review links). */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
/** Stored instead of raw email addresses when only equality checks are needed (unsubscribe list). */
export function hashEmail(shopId: string, email: string): string {
  return sha256Hex(`${shopId}:${email.trim().toLowerCase()}`);
}

function sign(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function signPayload(secret: string, payload: Record<string, unknown>, expiresAt: Date): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(expiresAt.getTime() / 1000) })).toString("base64url");
  return `${body}.${sign(secret, body)}`;
}

export function verifySignedPayload(secret: string, token: string, now: Date): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  const expected = sign(secret, body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < now.getTime()) return null;
    return payload;
  } catch {
    return null;
  }
}
