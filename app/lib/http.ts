/** Client address used only as a rate-limit key. server.js overwrites X-Client-IP with Express's trusted value
 *  (req.ip), so callers cannot choose it. The X-Forwarded-For fallback exists only for local development without Express. */
export function clientIp(headers: Headers): string {
  const valid = (v: string | null | undefined) => (v && /^[0-9a-fA-F:.]{3,45}$/.test(v.trim()) ? v.trim() : null);
  return valid(headers.get("x-client-ip")) ?? valid(headers.get("x-forwarded-for")?.split(",")[0]) ?? "unknown";
}
export const noStore = { "Cache-Control": "no-store" } as const;
