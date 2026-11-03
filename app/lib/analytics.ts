/** Pure aggregation helpers. Inputs come from real database counts; nothing here invents data. */
export type RatingCounts = Record<1 | 2 | 3 | 4 | 5, number>;
export interface RatingSummary { total: number; average: number | null; distribution: { rating: 1 | 2 | 3 | 4 | 5; count: number; percent: number }[] }

export function summarizeRatings(counts: Partial<RatingCounts>): RatingSummary {
  const ratings = [5, 4, 3, 2, 1] as const;
  const total = ratings.reduce((s, r) => s + (counts[r] ?? 0), 0);
  const sum = ratings.reduce((s, r) => s + r * (counts[r] ?? 0), 0);
  return {
    total,
    average: total ? Math.round((sum / total) * 100) / 100 : null,
    distribution: ratings.map((rating) => ({ rating, count: counts[rating] ?? 0, percent: total ? Math.round(((counts[rating] ?? 0) / total) * 100) : 0 })),
  };
}

/** Counts items per ISO week start (Monday, UTC) for the last `weeks` weeks, oldest first. */
export function bucketByWeek(dates: Date[], weeks: number, now: Date): { weekStart: string; count: number }[] {
  const startOfWeek = (d: Date) => {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
    return x;
  };
  const current = startOfWeek(now);
  const buckets: { weekStart: string; count: number }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const w = new Date(current); w.setUTCDate(w.getUTCDate() - i * 7);
    buckets.push({ weekStart: w.toISOString().slice(0, 10), count: 0 });
  }
  for (const d of dates) {
    const key = startOfWeek(d).toISOString().slice(0, 10);
    const b = buckets.find((x) => x.weekStart === key);
    if (b) b.count++;
  }
  return buckets;
}
