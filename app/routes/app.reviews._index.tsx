import { Form, Link, useActionData, useLoaderData, useNavigation, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import type { ReviewStatus } from "@prisma/client";
import { denyIfLacking, getProductTitles, requireMerchant } from "../services/shop.server.ts";
import { bulkModerate, isModerationAction, listReviews, moderateReview, type ReviewFilters } from "../services/reviews.server.ts";
import { hasFeature } from "../lib/plans.ts";
import { parsePagination } from "../lib/pagination.ts";
import { Locked, Notice, Pager, Stars, StatusBadge, fmtDate } from "../components/ui.tsx";

const STATUSES = ["PENDING", "PUBLISHED", "REJECTED", "HIDDEN"] as const;
const SORTS = ["newest", "oldest", "highest", "lowest"] as const;

function filtersFrom(p: URLSearchParams): ReviewFilters {
  const status = p.get("status") as ReviewStatus | null;
  const rating = Number(p.get("rating"));
  const from = p.get("from") ? new Date(p.get("from")!) : undefined;
  const to = p.get("to") ? new Date(`${p.get("to")}T23:59:59Z`) : undefined;
  const sort = p.get("sort") as (typeof SORTS)[number] | null;
  return {
    status: status && (STATUSES as readonly string[]).includes(status) ? status : undefined,
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : undefined,
    productId: /^\d{1,20}$/.test(p.get("product") ?? "") ? p.get("product")! : undefined,
    q: p.get("q")?.trim().slice(0, 100) || undefined,
    verified: p.get("verified") === "1" ? true : p.get("verified") === "0" ? false : undefined,
    hasMedia: p.get("photos") === "1" || undefined,
    from: from && !Number.isNaN(from.getTime()) ? from : undefined,
    to: to && !Number.isNaN(to.getTime()) ? to : undefined,
    sort: sort && (SORTS as readonly string[]).includes(sort) ? sort : undefined,
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop, ent } = await requireMerchant(request);
  if (!hasFeature(ent, "reviews.manage")) return { locked: true as const };
  const url = new URL(request.url);
  const page = parsePagination(url.searchParams);
  const { items, total } = await listReviews(shop.id, filtersFrom(url.searchParams), page);
  const titles = await getProductTitles(admin, items.map((i) => i.shopifyProductId));
  return {
    locked: false as const, total, page: page.page, limit: page.limit, bulk: hasFeature(ent, "moderation.bulk"),
    items: items.map((r) => ({ id: r.id, productId: r.shopifyProductId, product: titles.get(r.shopifyProductId) ?? `Product ${r.shopifyProductId}`, rating: r.rating, title: r.title, body: r.body, name: r.reviewerName, status: r.status, verified: r.verifiedPurchase, createdAt: r.createdAt, replied: Boolean(r.reply), photos: r._count.media })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, ent, actor } = await requireMerchant(request);
  const denied = denyIfLacking(ent, "reviews.moderate");
  if (denied) return denied;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  // Single-row action, e.g. "one:approve:<id>". Allowed on every plan.
  if (intent.startsWith("one:")) {
    const [, act, id] = intent.split(":");
    if (!act || !id || !isModerationAction(act)) return { error: "Unknown action" };
    const r = await moderateReview(shop.id, id, act, actor);
    return r ? { message: "Review updated" } : { error: "Review not found" };
  }
  // Bulk actions are an Advanced feature and are checked here on the server.
  if (intent.startsWith("bulk:")) {
    const bulkDenied = denyIfLacking(ent, "moderation.bulk");
    if (bulkDenied) return bulkDenied;
    const act = intent.slice(5);
    const ids = form.getAll("ids").map(String);
    if (!isModerationAction(act) || !ids.length) return { error: "Choose reviews and an action" };
    const n = await bulkModerate(shop.id, ids, act, actor);
    return { message: `${n} review${n === 1 ? "" : "s"} updated` };
  }
  return { error: "Unknown action" };
};

export default function Reviews() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as { message?: string; error?: string } | undefined;
  const busy = useNavigation().state !== "idle";
  if (data.locked) return <s-page heading="Reviews"><Locked what="Review management" plan="Basic" /></s-page>;
  return (
    <s-page heading="Reviews">
      <Notice data={result} />
      <s-section>
        <Form method="get" className="pr-toolbar" role="search">
          <label>Search<input type="search" name="q" placeholder="Words, title or name" /></label>
          <label>Status<select name="status"><option value="">Any</option>{STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</select></label>
          <label>Rating<select name="rating"><option value="">Any</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} stars</option>)}</select></label>
          <label>Verified<select name="verified"><option value="">Any</option><option value="1">Verified only</option><option value="0">Not verified</option></select></label>
          <label>Photos<select name="photos"><option value="">Any</option><option value="1">With photos</option></select></label>
          <label>From<input type="date" name="from" /></label>
          <label>To<input type="date" name="to" /></label>
          <label>Product ID<input type="text" name="product" inputMode="numeric" /></label>
          <label>Sort<select name="sort">{SORTS.map((s) => <option key={s} value={s}>{s === "newest" ? "Newest" : s === "oldest" ? "Oldest" : s === "highest" ? "Highest rating" : "Lowest rating"}</option>)}</select></label>
          <button className="pr-btn" type="submit">Apply filters</button>
          <Link className="pr-btn" to="/app/reviews">Clear</Link>
        </Form>
        {data.items.length === 0 ? (
          <s-paragraph>No reviews match these filters. Reviews appear here as shoppers submit them or when you import them.</s-paragraph>
        ) : (
          <Form method="post">
            {data.bulk ? (
              <div className="pr-toolbar">
                <button className="pr-btn" name="intent" value="bulk:approve" disabled={busy}>Approve selected</button>
                <button className="pr-btn" name="intent" value="bulk:hide" disabled={busy}>Hide selected</button>
                <button className="pr-btn" name="intent" value="bulk:reject" disabled={busy}>Reject selected</button>
              </div>
            ) : (
              <s-paragraph>Bulk actions are part of the Advanced plan. You can still approve, reject or hide reviews one at a time.</s-paragraph>
            )}
            <div className="pr-table-wrap">
              <table className="pr-table">
                <thead><tr>{data.bulk && <th><span className="pr-muted">Select</span></th>}<th>Review</th><th>Rating</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id}>
                      {data.bulk && <td><input type="checkbox" name="ids" value={r.id} aria-label={`Select review by ${r.name}`} /></td>}
                      <td>
                        <Link to={`/app/reviews/${r.id}`}><strong>{r.title || r.body.slice(0, 60)}</strong></Link>
                        <div className="pr-muted">{r.name} on {r.product}{r.verified ? " · Verified purchase" : ""}{r.photos ? ` · ${r.photos} photo${r.photos > 1 ? "s" : ""}` : ""}{r.replied ? " · Replied" : ""}</div>
                        <div>{r.body.length > 140 ? `${r.body.slice(0, 140)}…` : r.body}</div>
                      </td>
                      <td><Stars n={r.rating} /></td>
                      <td><StatusBadge status={r.status} /></td>
                      <td>{fmtDate(r.createdAt)}</td>
                      <td>
                        <div className="pr-row">
                          {r.status !== "PUBLISHED" && <button className="pr-btn" name="intent" value={`one:approve:${r.id}`} disabled={busy}>Approve</button>}
                          {r.status === "PUBLISHED" && <button className="pr-btn" name="intent" value={`one:hide:${r.id}`} disabled={busy}>Hide</button>}
                          {r.status === "PENDING" && <button className="pr-btn" name="intent" value={`one:reject:${r.id}`} disabled={busy}>Reject</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Form>
        )}
        <Pager total={data.total} page={data.page} limit={data.limit} />
      </s-section>
    </s-page>
  );
}
