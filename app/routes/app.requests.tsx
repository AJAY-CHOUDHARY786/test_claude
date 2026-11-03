import { Form, Link, useActionData, useLoaderData, useNavigation, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { denyIfLacking, requireMerchant } from "../services/shop.server.ts";
import { listRequests, sendRequestNow } from "../services/requests.server.ts";
import { hasFeature } from "../lib/plans.ts";
import { parsePagination } from "../lib/pagination.ts";
import { Locked, Notice, Pager, StatusBadge, fmtDate } from "../components/ui.tsx";

const STATUSES = ["QUEUED", "SENT", "COMPLETED", "FAILED", "CANCELLED", "SKIPPED"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, ent } = await requireMerchant(request);
  if (!hasFeature(ent, "requests.basic")) return { locked: true as const };
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? undefined;
  const page = parsePagination(url.searchParams);
  const [items, total] = await listRequests(shop.id, status && STATUSES.includes(status) ? status : undefined, page);
  return { locked: false as const, items, total, page: page.page, limit: page.limit, enabled: shop.settings?.requestsEnabled ?? false, canSendNow: hasFeature(ent, "requests.advanced") };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, ent } = await requireMerchant(request);
  const denied = denyIfLacking(ent, "requests.advanced");
  if (denied) return denied;
  const form = await request.formData();
  const ok = await sendRequestNow(shop.id, String(form.get("id") ?? ""));
  return ok ? { message: "Queued to send now. The normal checks still apply." } : { error: "That request can no longer be sent." };
};

export default function Requests() {
  const d = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as { message?: string; error?: string } | undefined;
  const busy = useNavigation().state !== "idle";
  if (d.locked) return <s-page heading="Review requests"><Locked what="Review requests" plan="Basic" /></s-page>;
  return (
    <s-page heading="Review requests">
      <Notice data={result} />
      {!d.enabled && <s-banner tone="info" heading="Review request emails are off">Nothing is sent until you turn them on in <Link to="/app/settings">Settings</Link>.</s-banner>}
      <s-section>
        <Form method="get" className="pr-toolbar">
          <label>Status<select name="status"><option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</select></label>
          <button className="pr-btn" type="submit">Filter</button>
        </Form>
        {d.items.length === 0 ? <s-paragraph>No review requests yet. They appear here after orders are fulfilled, once request emails are turned on.</s-paragraph> : (
          <div className="pr-table-wrap"><table className="pr-table">
            <thead><tr><th>Order</th><th>Product</th><th>Type</th><th>Status</th><th>Scheduled</th><th>Sent</th><th>Delivery</th><th>Note</th><th>Action</th></tr></thead>
            <tbody>{d.items.map((r) => (
              <tr key={r.id}>
                <td>#{r.shopifyOrderId}</td><td>{r.productTitle}</td><td>{r.kind === "REMINDER" ? "Reminder" : "Request"}</td>
                <td><StatusBadge status={r.status} /></td><td>{fmtDate(r.sendAt)}</td><td>{fmtDate(r.sentAt)}</td>
                <td>{r.deliveryStatus ? r.deliveryStatus : r.status === "SENT" ? <span className="pr-muted">Accepted by email service</span> : ""}</td>
                <td className="pr-muted">{r.lastError ?? ""}</td>
                <td>{r.status === "QUEUED" && (
                  <Form method="post"><input type="hidden" name="id" value={r.id} />
                    <button className="pr-btn" disabled={busy || !d.canSendNow} title={d.canSendNow ? "" : "Available on the Advanced plan"}>Send now</button></Form>)}</td>
              </tr>))}</tbody>
          </table></div>
        )}
        <Pager total={d.total} page={d.page} limit={d.limit} />
        <s-paragraph>"Sent" means the email service accepted the message. A Delivery status of delivered, bounced or complained appears only after you connect the email service event webhook (see the README).</s-paragraph>
      </s-section>
    </s-page>
  );
}
