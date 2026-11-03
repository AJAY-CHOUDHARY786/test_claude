import { useEffect } from "react";
import { data, useFetcher, useLoaderData, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import prisma from "../db.server.ts";
import { requireMerchant } from "../services/shop.server.ts";
import { APP_NAME } from "../lib/brand.ts";
import { fmtDate } from "../components/ui.tsx";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireMerchant(request);
  const requests = await prisma.auditLog.findMany({ where: { shopId: shop.id, action: "privacy.data_request" }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, createdAt: true } });
  return { support: process.env.SUPPORT_EMAIL?.trim() || null, shopDomain: shop.domain, requests };
};

// Customer data requests forwarded by Shopify are collected here for the merchant to download.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireMerchant(request);
  const id = String((await request.formData()).get("id") ?? "");
  const row = await prisma.auditLog.findFirst({ where: { id, shopId: shop.id, action: "privacy.data_request" } });
  if (!row) return data({ error: "Not found" }, { status: 404 });
  return { json: JSON.stringify(row.meta, null, 2), filename: `customer-data-request-${row.id}.json` };
};

export default function Help() {
  const d = useLoaderData<typeof loader>();
  const dl = useFetcher<{ json?: string; filename?: string }>();
  useEffect(() => {
    if (!dl.data?.json) return;
    const url = URL.createObjectURL(new Blob([dl.data.json], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = dl.data.filename ?? "data.json"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }, [dl.data]);
  const editor = `https://${d.shopDomain}/admin/themes/current/editor?template=product`;
  return (
    <s-page heading="Help and support">
      <s-section heading="Add the review widget to your store">
        <ol>
          <li>Open the <a href={editor} target="_top">theme editor on a product page</a>.</li>
          <li>Choose <strong>Add block</strong> or <strong>Add section</strong> in the product template, then pick <strong>Product reviews</strong> under Apps.</li>
          <li>Optionally add the <strong>Star rating</strong> block near the product title.</li>
          <li>Save. Reviews you have published appear right away; new ones show after you approve them.</li>
        </ol>
        <s-paragraph>No theme code needs editing. If a block does not appear, your theme may not support app blocks on that template.</s-paragraph>
      </s-section>
      <s-section heading="Contact support">
        {d.support ? <s-paragraph>Email <a href={`mailto:${d.support}`}>{d.support}</a> and include your store address ({d.shopDomain}).</s-paragraph> : <s-banner tone="warning">No support address is configured. The app owner needs to set SUPPORT_EMAIL.</s-banner>}
      </s-section>
      <s-section heading="Customer data requests">
        <s-paragraph>When a customer asks Shopify for the data stores hold about them, Shopify notifies this app. The review data we hold for that customer is collected here for you to download and pass on.</s-paragraph>
        {d.requests.length === 0 ? <s-paragraph>No requests.</s-paragraph> : <ul>{d.requests.map((r) => <li key={r.id}>{fmtDate(r.createdAt)} <dl.Form method="post" style={{ display: "inline" }}><input type="hidden" name="id" value={r.id} /><button className="pr-btn">Download</button></dl.Form></li>)}</ul>}
      </s-section>
      <s-section heading="About your data">
        <s-paragraph>{APP_NAME} stores reviews, optional photos, and the customer email and first name needed to send review requests. Customer email and name are removed 90 days after a request is finished. Deleted reviews are erased after 30 days. When you uninstall the app, Shopify asks us to erase all of your data and we do.</s-paragraph>
      </s-section>
    </s-page>
  );
}
