import { data, Form, useActionData, useLoaderData, useNavigation, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import prisma from "../db.server.ts";
import { denyIfLacking, getProductTitles, requireMerchant } from "../services/shop.server.ts";
import { collectLink } from "../services/links.server.ts";
import { hasFeature } from "../lib/plans.ts";
import { validateProductOverride } from "../lib/settings-validation.ts";
import { parsePagination } from "../lib/pagination.ts";
import { Locked, Notice, Pager } from "../components/ui.tsx";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop, ent } = await requireMerchant(request);
  if (!hasFeature(ent, "reviews.manage")) return { locked: true as const };
  const url = new URL(request.url);
  const page = parsePagination(url.searchParams, { defaultLimit: 25, maxLimit: 50 });
  const extra = /^\d{1,20}$/.test(url.searchParams.get("product") ?? "") ? url.searchParams.get("product")! : null;

  const [totals, published, pending, overrides] = await Promise.all([
    prisma.review.groupBy({ by: ["shopifyProductId"], where: { shopId: shop.id, deletedAt: null }, _count: { _all: true }, orderBy: { _count: { shopifyProductId: "desc" } }, skip: page.skip, take: page.limit }),
    prisma.review.groupBy({ by: ["shopifyProductId"], where: { shopId: shop.id, deletedAt: null, status: "PUBLISHED" }, _count: { _all: true }, _avg: { rating: true } }),
    prisma.review.groupBy({ by: ["shopifyProductId"], where: { shopId: shop.id, deletedAt: null, status: "PENDING" }, _count: { _all: true } }),
    prisma.productWidgetSetting.findMany({ where: { shopId: shop.id } }),
  ]);
  const distinct = await prisma.review.groupBy({ by: ["shopifyProductId"], where: { shopId: shop.id, deletedAt: null } });
  const ids = [...new Set([...totals.map((t) => t.shopifyProductId), ...(extra ? [extra] : [])])];
  const titles = await getProductTitles(admin, ids);
  const pub = new Map<string, (typeof published)[number]>(published.map((p) => [p.shopifyProductId, p] as const));
  const pend = new Map<string, number>(pending.map((p) => [p.shopifyProductId, p._count._all] as const));
  const ov = new Map<string, (typeof overrides)[number]>(overrides.map((o) => [o.shopifyProductId, o] as const));
  const rows = ids.map((id) => ({
    id, title: titles.get(id) ?? `Product ${id}`, total: totals.find((t) => t.shopifyProductId === id)?._count._all ?? 0,
    published: pub.get(id)?._count._all ?? 0, average: pub.get(id)?._avg.rating ? Math.round(pub.get(id)!._avg.rating! * 100) / 100 : null,
    pending: pend.get(id) ?? 0, hidden: ov.get(id)?.hidden ?? false, layout: ov.get(id)?.layout ?? "", accent: ov.get(id)?.accentColor ?? "",
    link: hasFeature(ent, "storefront.collect") ? collectLink(shop.id, id) : null,
  }));
  return { locked: false as const, rows, total: distinct.length, page: page.page, limit: page.limit, canCustomize: hasFeature(ent, "widgets.customize") };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, ent } = await requireMerchant(request);
  const denied = denyIfLacking(ent, "widgets.customize");
  if (denied) return denied;
  const f = await request.formData();
  const productId = String(f.get("productId") ?? "");
  if (!/^\d{1,20}$/.test(productId)) return data({ error: "Enter a numeric product ID." }, { status: 422 });
  const intent = String(f.get("intent") ?? "");
  if (intent === "reset") {
    await prisma.productWidgetSetting.deleteMany({ where: { shopId: shop.id, shopifyProductId: productId } });
    return { message: "Product settings reset" };
  }
  if (intent === "save") {
    const v = validateProductOverride(f);
    if (!v.ok) return data({ error: v.error }, { status: 422 });
    await prisma.productWidgetSetting.upsert({ where: { shopId_shopifyProductId: { shopId: shop.id, shopifyProductId: productId } }, create: { shopId: shop.id, shopifyProductId: productId, ...v.value }, update: v.value });
    return { message: "Product settings saved" };
  }
  return data({ error: "Unknown action" }, { status: 400 });
};

export default function Products() {
  const d = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as { message?: string; error?: string } | undefined;
  const busy = useNavigation().state !== "idle";
  if (d.locked) return <s-page heading="Products"><Locked what="Product reviews" plan="Basic" /></s-page>;
  return (
    <s-page heading="Products">
      <Notice data={result} />
      <s-section>
        <s-paragraph>Review totals for each product that has reviews. Share a review link to collect reviews anywhere (social posts, packaging inserts). Reviews from a shared link are not marked as verified purchases.</s-paragraph>
        {!d.canCustomize && <s-banner tone="info">Hiding the widget or changing its look for a single product is part of the Advanced plan.</s-banner>}
        {d.rows.length === 0 ? <s-paragraph>No products have reviews yet.</s-paragraph> : (
          <div className="pr-table-wrap"><table className="pr-table">
            <thead><tr><th>Product</th><th>Published</th><th>Average</th><th>Pending</th><th>Review link</th><th>Widget on this product</th></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.title}</strong><div className="pr-muted">ID {r.id}</div></td>
                <td>{r.published}</td><td>{r.average ?? "–"}</td><td>{r.pending}</td>
                <td>{r.link ? <input type="text" readOnly value={r.link} aria-label={`Review link for ${r.title}`} onFocus={(e) => e.currentTarget.select()} style={{ width: 180 }} /> : <span className="pr-muted">Needs an active plan</span>}</td>
                <td>
                  <Form method="post" className="pr-row">
                    <input type="hidden" name="productId" value={r.id} />
                    <label><input type="checkbox" name="hidden" defaultChecked={r.hidden} disabled={!d.canCustomize} /> Hide</label>
                    <select name="layout" defaultValue={r.layout} disabled={!d.canCustomize} aria-label="Layout"><option value="">Store default</option><option value="list">List</option><option value="grid">Grid</option></select>
                    <input type="text" name="accentColor" defaultValue={r.accent} placeholder="#1f4b3f" size={8} disabled={!d.canCustomize} aria-label="Accent color" />
                    <button className="pr-btn" name="intent" value="save" disabled={busy || !d.canCustomize}>Save</button>
                    <button className="pr-btn" name="intent" value="reset" disabled={busy || !d.canCustomize}>Reset</button>
                  </Form>
                </td>
              </tr>))}</tbody>
          </table></div>)}
        <Pager total={d.total} page={d.page} limit={d.limit} />
      </s-section>
      <s-section heading="Add a product that has no reviews yet">
        <Form method="get" className="pr-toolbar"><label>Product ID<input type="text" name="product" inputMode="numeric" /></label><button className="pr-btn">Show</button></Form>
      </s-section>
    </s-page>
  );
}
