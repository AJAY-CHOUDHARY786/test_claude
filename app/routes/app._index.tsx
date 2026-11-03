import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import { requireMerchant } from "../services/shop.server.ts";
import { dashboardStats } from "../services/reviews.server.ts";
import { getStorage } from "../services/storage.server.ts";
import { hasFeature } from "../lib/plans.ts";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, ent } = await requireMerchant(request);
  const stats = await dashboardStats(shop.id);
  return {
    stats, active: ent.active, plan: ent.plan, inTrial: ent.inTrial,
    requestsEnabled: shop.settings?.requestsEnabled ?? false, canRequest: hasFeature(ent, "requests.basic"),
    photosReady: Boolean(await getStorage()),
  };
};

export default function Dashboard() {
  const d = useLoaderData<typeof loader>();
  const { ratings, pending, last30, requests } = d.stats;
  const empty = ratings.total === 0 && pending === 0;
  return (
    <s-page heading="Dashboard">
      {!d.active && (
        <s-banner tone="warning" heading="Choose a plan to start collecting reviews">
          <s-paragraph>Both plans include a 30-day free trial. Reviews that are already published stay visible on your store.</s-paragraph>
          <s-button slot="secondary-actions" href="/app/billing">Choose a plan</s-button>
        </s-banner>
      )}
      {d.inTrial && <s-banner tone="info">You are on a free trial of the {d.plan === "advanced" ? "Advanced" : "Basic"} plan.</s-banner>}
      {pending > 0 && (
        <s-banner tone="warning" heading={`${pending} review${pending > 1 ? "s" : ""} waiting for approval`}>
          <s-button slot="secondary-actions" href="/app/reviews?status=PENDING">Review them</s-button>
        </s-banner>
      )}
      <s-section heading="At a glance">
        <div className="pr-grid">
          <div className="pr-stat"><b>{ratings.total}</b><span>Published reviews</span></div>
          <div className="pr-stat"><b>{ratings.average ?? "–"}</b><span>Average rating</span></div>
          <div className="pr-stat"><b>{pending}</b><span>Waiting for approval</span></div>
          <div className="pr-stat"><b>{last30}</b><span>New in the last 30 days</span></div>
        </div>
      </s-section>
      {empty ? (
        <s-section heading="Get your first reviews">
          <s-paragraph>No reviews yet. Add the review widget to a product page, import existing reviews, or turn on review request emails.</s-paragraph>
          <div className="pr-row">
            <s-button href="/app/help">Add the widget to your theme</s-button>
            <s-button href="/app/import-export">Import reviews</s-button>
            <s-button href="/app/settings">Review request settings</s-button>
          </div>
        </s-section>
      ) : (
        <s-section heading="Rating breakdown">
          {ratings.distribution.map((r) => (
            <div className="pr-dist" key={r.rating}><span>{r.rating} ★</span><i style={{ width: `${r.percent}%`, minWidth: r.count ? 4 : 0 }} /><span className="pr-muted">{r.count}</span></div>
          ))}
        </s-section>
      )}
      <s-section heading="Review requests">
        {!d.canRequest ? <s-paragraph>Review request emails need an active plan.</s-paragraph>
          : !d.requestsEnabled ? <s-paragraph>Review request emails are turned off. Turn them on in Settings when you are ready; nothing is sent until then.</s-paragraph>
          : <s-paragraph>Queued: {requests.QUEUED ?? 0}. Sent: {requests.SENT ?? 0}. Completed with a review: {requests.COMPLETED ?? 0}. Failed: {requests.FAILED ?? 0}.</s-paragraph>}
      </s-section>
      {!d.photosReady && <s-banner tone="info">Photo reviews are off because photo storage has not been configured.</s-banner>}
    </s-page>
  );
}
