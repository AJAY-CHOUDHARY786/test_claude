/** Verifies webhook signatures from email providers that use the Svix scheme (Resend does). */
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifySvixSignature(o: { secret: string; id: string; timestamp: string; body: string; signatureHeader: string; now: Date; toleranceSeconds?: number }): boolean {
  const { secret, id, timestamp, body, signatureHeader, now } = o;
  if (!secret || !id || !timestamp || !signatureHeader) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now.getTime() / 1000 - ts) > (o.toleranceSeconds ?? 300)) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  const exp = Buffer.from(expected);
  return signatureHeader.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const got = Buffer.from(sig);
    return got.length === exp.length && timingSafeEqual(got, exp);
  });
}
