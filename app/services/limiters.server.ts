import { createRateLimiter } from "../lib/rate-limit.ts";

const HOUR = 3_600_000;
export const submitLimiter = createRateLimiter({ limit: 5, windowMs: HOUR });
export const uploadLimiter = createRateLimiter({ limit: 20, windowMs: HOUR });
export const questionLimiter = createRateLimiter({ limit: 5, windowMs: HOUR });
export const listLimiter = createRateLimiter({ limit: 120, windowMs: 60_000 });
export const publicPageLimiter = createRateLimiter({ limit: 20, windowMs: HOUR });
