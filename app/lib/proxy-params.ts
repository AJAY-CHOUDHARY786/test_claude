/** Query parameters for the storefront reviews list endpoint, validated. */
import { parsePagination } from "./pagination.ts";

export type ListSort = "newest" | "highest" | "lowest";
export interface ListParams { productId: string; page: number; limit: number; skip: number; sort: ListSort; rating: number | undefined; summaryOnly: boolean }

export function parseListParams(q: URLSearchParams, defaultLimit: number): ListParams | null {
  const productId = q.get("product_id") ?? "";
  if (!/^\d{1,20}$/.test(productId)) return null;
  const page = parsePagination(q, { defaultLimit, maxLimit: 50 });
  const sortRaw = q.get("sort");
  const sort: ListSort = sortRaw === "highest" || sortRaw === "lowest" ? sortRaw : "newest";
  const r = Number(q.get("rating"));
  return { productId, ...page, sort, rating: Number.isInteger(r) && r >= 1 && r <= 5 ? r : undefined, summaryOnly: q.get("summary") === "1" };
}
