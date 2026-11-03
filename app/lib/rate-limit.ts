/** Fixed-window in-memory rate limiter. Per-instance only; see docs/ARCHITECTURE.md for the multi-instance path. */
export interface RateLimitResult { allowed: boolean; remaining: number; retryAfterMs: number }
export interface RateLimiter { check(key: string): RateLimitResult }

export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? (() => Date.now());
  const hits = new Map<string, { count: number; resetAt: number }>();
  return {
    check(key) {
      const t = now();
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
      let entry = hits.get(key);
      if (!entry || entry.resetAt <= t) { entry = { count: 0, resetAt: t + opts.windowMs }; hits.set(key, entry); }
      entry.count++;
      const allowed = entry.count <= opts.limit;
      return { allowed, remaining: Math.max(0, opts.limit - entry.count), retryAfterMs: allowed ? 0 : entry.resetAt - t };
    },
  };
}
