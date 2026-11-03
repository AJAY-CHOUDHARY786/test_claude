import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import { getProductTitles, requireMerchant } from "../services/shop.server.ts";
import { advancedAnalytics, dashboardStats } from "../services/reviews.server.ts";
import { hasFeature } from "../lib/plans.ts";
import { Locked } from "../components/ui.tsx";

type Adv = Omit<Awaited<ReturnType<typeof advancedAnalytics>>, "top"> & { top: { productId: string; count: number; average: number | null; name: string }[] };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop, ent } = await requireMerchant(request);
  if (!hasFeature(ent, "analytics.basic")) return { locked: true as const };
  const basic = await dashboardStats(shop.id);
  let adv: Adv | null = null;
  if (hasFeature(ent, "analytics.advanced")) {
    const a = await advancedAnalytics(shop.id);
    const titles = await getProductTitles(admin, a.top.map((t) => t.productId));
    adv = { ...a, top: a.top.map((t) => ({ ...t, name: titles.get(t.productId) ?? `Product ${t.productId}` })) };
  }
  return { locked: false as const, basic, adv };
};

export default function Analytics() {
  const d = useLoaderData<typeof loader>();
  if (d.locked) return <s-page heading="Analytics"><Locked what="Analytics" plan="Basic" /></s-page>;
  const { ratings, pending, requests } = d.basic;
  const max = Math.max(1, ...(d.adv?.weekly.map((w) => w.count) ?? [1]));
  return (
    <s-page heading="Analytics">
      <s-section heading="Ratings">
        {ratings.total === 0 ? <s-paragraph>No published reviews yet, so there is nothing to chart.</s-paragraph> : (<>
          <div className="pr-grid">
            <div className="pr-stat"><b>{ratings.average}</b><span>Average rating</span></div>
            <div className="pr-stat"><b>{ratings.total}</b><span>Published reviews</span></div>
            <div className="pr-stat"><b>{pending}</b><span>Waiting for approval</span></div>
          </div>
          <div style={{ marginTop: 12 }}>{ratings.distribution.map((r) => <div className="pr-dist" key={r.rating}><span>{r.rating} ★</span><i style={{ width: `${r.percent}%`, minWidth: r.count ? 4 : 0 }} /><span className="pr-muted">{r.count} ({r.percent}%)</span></div>)}</div>
        </>)}
      </s-section>
      <s-section heading="Review requests">
        <div className="pr-grid">{["QUEUED", "SENT", "COMPLETED", "FAILED", "CANCELLED"].map((k) => <div className="pr-stat" key={k}><b>{requests[k] ?? 0}</b><span>{k.charAt(0) + k.slice(1).toLowerCase()}</span></div>)}</div>
      </s-section>
      {!d.adv ? <Locked what="Trends, top products and verified share" /> : (<>
        <s-section heading="New reviews per week (last 12 weeks)">
          <div className="pr-bars" role="img" aria-label="Bar chart of new reviews per week">{d.adv.weekly.map((w) => <div key={w.weekStart} style={{ height: `${(w.count / max) * 100}%` }} title={`${w.weekStart}: ${w.count}`}><span>{w.count || ""}</span></div>)}</div>
          <div className="pr-row pr-muted" style={{ justifyContent: "space-between" }}><span>{d.adv.weekly[0]?.weekStart}</span><span>{d.adv.weekly.at(-1)?.weekStart}</span></div>
        </s-section>
        <s-section heading="Most reviewed products">
          {d.adv.top.length === 0 ? <s-paragraph>No published reviews yet.</s-paragraph> : <div className="pr-table-wrap"><table className="pr-table"><thead><tr><th>Product</th><th>Reviews</th><th>Average</th></tr></thead><tbody>{d.adv.top.map((t) => <tr key={t.productId}><td>{t.name}</td><td>{t.count}</td><td>{t.average ?? "–"}</td></tr>)}</tbody></table></div>}
        </s-section>
        <s-section heading="Verified purchases"><s-paragraph>{d.adv.verifiedShare === null ? "No reviews yet." : `${d.adv.verifiedShare}% of your ${d.adv.total} reviews come from a review request sent after a real order.`}</s-paragraph></s-section>
      </>)}
    </s-page>
  );
}
