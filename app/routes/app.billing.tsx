import { Form, useActionData, useLoaderData, useNavigation, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import prisma from "../db.server.ts";
import { requireMerchant } from "../services/shop.server.ts";
import { planSelectionUrl, syncSubscription } from "../services/billing.server.ts";
import { PLAN_CATALOG } from "../lib/plans.ts";
import { FEATURE_LABELS } from "../lib/feature-labels.ts";
import { Notice, fmtDate } from "../components/ui.tsx";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, ent } = await requireMerchant(request);
  const sub = await prisma.subscription.findUnique({ where: { shopId: shop.id } });
  return { ent: { active: ent.active, plan: ent.plan, inTrial: ent.inTrial }, sub: sub ? { status: sub.status, trialEndsAt: sub.trialEndsAt, test: sub.isTest, periodEnd: sub.currentPeriodEnd } : null, url: planSelectionUrl(shop.domain), plans: Object.values(PLAN_CATALOG).map((p) => ({ id: p.id, name: p.name, price: p.priceUsdMonthly, trial: p.trialDays, features: p.features as readonly string[] })) };
};

// Billing is handled on Shopify's own pricing page. This only re-reads the truth from Shopify.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop } = await requireMerchant(request);
  await syncSubscription(admin, shop.id);
  return { message: "Billing status refreshed from Shopify" };
};

export default function Billing() {
  const d = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as { message?: string } | undefined;
  const busy = useNavigation().state !== "idle";
  const allFeatures = [...new Set(d.plans.flatMap((p) => p.features))];
  return (
    <s-page heading="Plans and billing">
      <Notice data={result} />
      <s-section heading="Your plan">
        {d.ent.active ? (
          <s-paragraph>You are on the <strong>{d.ent.plan === "advanced" ? "Advanced" : "Basic"}</strong> plan{d.ent.inTrial && d.sub?.trialEndsAt ? `, in your free trial until ${fmtDate(d.sub.trialEndsAt)}` : ""}.{d.sub?.test ? " This is a test subscription and is not charged." : ""}</s-paragraph>
        ) : (
          <s-paragraph>You do not have an active plan{d.sub && d.sub.status !== "NONE" ? ` (status: ${d.sub.status.toLowerCase()})` : ""}. Your published reviews still show on your store and you can export your data, but management features are paused.</s-paragraph>
        )}
        <div className="pr-row">
          {d.url ? <a className="pr-btn primary" href={d.url} target="_top">{d.ent.active ? "Change or cancel plan" : "Choose a plan"}</a> : <s-banner tone="warning">The plan page link needs SHOPIFY_APP_HANDLE to be set on the server.</s-banner>}
          <Form method="post"><button className="pr-btn" disabled={busy}>Refresh status</button></Form>
        </div>
        <s-paragraph>Plans, free trials and charges are handled by Shopify. Both plans include a {d.plans[0]?.trial}-day free trial. A store that reinstalls the app does not get a fresh trial.</s-paragraph>
      </s-section>
      <s-section heading="Compare plans">
        <div className="pr-table-wrap"><table className="pr-table">
          <thead><tr><th>Feature</th>{d.plans.map((p) => <th key={p.id}>{p.name}<div className="pr-muted">${p.price}/month</div></th>)}</tr></thead>
          <tbody>{allFeatures.filter((f) => f !== "storefront.display" || true).map((f) => (
            <tr key={f}><td>{FEATURE_LABELS[f as keyof typeof FEATURE_LABELS] ?? f}</td>{d.plans.map((p) => <td key={p.id}>{p.features.includes(f) ? <span aria-label="Included">Included</span> : <span className="pr-muted" aria-label="Not included">Not included</span>}</td>)}</tr>))}</tbody>
        </table></div>
      </s-section>
    </s-page>
  );
}
