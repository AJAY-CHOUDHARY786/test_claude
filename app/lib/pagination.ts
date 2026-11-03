export interface Page { page: number; limit: number; skip: number }

/** Reads page and limit from the query string. A missing or blank value uses the default (it is NOT treated as 0). */
export function parsePagination(params: URLSearchParams, opts = { defaultLimit: 25, maxLimit: 100 }): Page {
  const int = (v: string | null, d: number) => {
    if (v === null || v.trim() === "") return d;
    const n = Number(v);
    return Number.isInteger(n) ? n : d;
  };
  const page = Math.min(10_000, Math.max(1, int(params.get("page"), 1)));
  const limit = Math.min(opts.maxLimit, Math.max(1, int(params.get("limit"), opts.defaultLimit)));
  return { page, limit, skip: (page - 1) * limit };
}
