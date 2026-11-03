import { data, Form, useActionData, useLoaderData, useNavigation, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import prisma from "../db.server.ts";
import { env } from "../config.server.ts";
import { getSettings, requireMerchant, writeAudit } from "../services/shop.server.ts";
import { DEFAULT_TEMPLATES, validateTemplate } from "../lib/email-template.ts";
import { hasFeature } from "../lib/plans.ts";
import { buildGeneralUpdate, buildRequestsUpdate, validateWidgetUpdate } from "../lib/settings-validation.ts";
import { Field, Notice } from "../components/ui.tsx";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, ent } = await requireMerchant(request);
  const [settings, templates] = await Promise.all([getSettings(shop.id), prisma.emailTemplate.findMany({ where: { shopId: shop.id } })]);
  const tpl = (k: "REQUEST" | "REMINDER") => templates.find((t) => t.kind === k) ?? { subject: DEFAULT_TEMPLATES[k].subject, body: DEFAULT_TEMPLATES[k].body };
  return {
    s: { ...settings, excludedProductIds: settings.excludedProductIds.join(", "), updatedAt: undefined },
    request: tpl("REQUEST"), reminder: tpl("REMINDER"),
    can: { requests: hasFeature(ent, "requests.basic"), advancedRequests: hasFeature(ent, "requests.advanced"), widget: hasFeature(ent, "widgets.customize"), photos: hasFeature(ent, "media.photos") },
    emailMode: env.email.mode, storage: Boolean(env.storage),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, ent, actor } = await requireMerchant(request);
  const f = await request.formData();
  const intent = String(f.get("intent") ?? "");
  const advanced = hasFeature(ent, "requests.advanced");

  if (intent === "general") {
    await prisma.shopSettings.update({ where: { shopId: shop.id }, data: buildGeneralUpdate(f) });
  } else if (intent === "requests") {
    if (!hasFeature(ent, "requests.basic")) return data({ error: "Your plan does not include review requests." }, { status: 403 });
    const update = buildRequestsUpdate(f, advanced); // fields the plan does not include are never present
    await prisma.shopSettings.update({ where: { shopId: shop.id }, data: update });
    await writeAudit(shop.id, actor, update.requestsEnabled ? "requests.enabled" : "requests.disabled");
  } else if (intent === "widget") {
    if (!hasFeature(ent, "widgets.customize")) return data({ error: "Widget customization is part of the Advanced plan." }, { status: 403 });
    const v = validateWidgetUpdate(f);
    if (!v.ok) return data({ error: v.error }, { status: 422 });
    await prisma.shopSettings.update({ where: { shopId: shop.id }, data: v.value });
  } else if (intent === "template") {
    if (!advanced) return data({ error: "Custom email text is part of the Advanced plan." }, { status: 403 });
    const kind = f.get("kind") === "REMINDER" ? "REMINDER" : "REQUEST";
    const subject = String(f.get("subject") ?? "").trim(), body = String(f.get("body") ?? "").trim();
    const problem = validateTemplate(subject, body);
    if (problem) return data({ error: problem }, { status: 422 });
    await prisma.emailTemplate.upsert({ where: { shopId_kind: { shopId: shop.id, kind } }, create: { shopId: shop.id, kind, subject, body }, update: { subject, body } });
  } else return data({ error: "Unknown action" }, { status: 400 });
  return { message: "Settings saved" };
};

export default function Settings() {
  const d = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as { message?: string; error?: string } | undefined;
  const busy = useNavigation().state !== "idle";
  const s = d.s;
  return (
    <s-page heading="Settings">
      <Notice data={result} />
      <s-section heading="Reviews">
        <Form method="post">
          <Field label="Moderation" hint="When off, new reviews wait in Pending until you approve them."><label><input type="checkbox" name="autoPublish" defaultChecked={s.autoPublish} /> Publish new reviews automatically</label></Field>
          <Field label="Reviews per page on your store"><input type="number" name="reviewsPerPage" min={5} max={50} defaultValue={s.reviewsPerPage} /></Field>
          <Field label="Badges"><label><input type="checkbox" name="showVerifiedBadge" defaultChecked={s.showVerifiedBadge} /> Show "Verified purchase" badge</label></Field>
          <Field label="Photos" hint={d.storage ? "Shoppers can add up to 5 photos to a review." : "Photo storage is not configured on this server, so photos stay off."}>
            <label><input type="checkbox" name="allowPhotos" defaultChecked={s.allowPhotos} disabled={!d.storage || !d.can.photos} /> Let shoppers add photos</label></Field>
          <Field label="Search engine markup" hint="Adds star ratings to search results using your real published reviews. Turn off if your theme already outputs product ratings."><label><input type="checkbox" name="emitStructuredData" defaultChecked={s.emitStructuredData} /> Add review structured data</label></Field>
          <button className="pr-btn primary" name="intent" value="general" disabled={busy}>Save</button>
        </Form>
      </s-section>
      <s-section heading="Review request emails">
        {d.emailMode === "sink" && <s-banner tone="info">This server is in test mode: request emails are logged but not sent to anyone.</s-banner>}
        <Form method="post">
          <Field label="Automatic requests" hint="After an order is fulfilled, customers get an email asking for a review. Nothing is sent while this is off."><label><input type="checkbox" name="requestsEnabled" defaultChecked={s.requestsEnabled} disabled={!d.can.requests} /> Send review request emails</label></Field>
          <Field label="Days to wait after fulfilment" hint={d.can.advancedRequests ? "0 to 90 days." : "1 to 30 days. Advanced allows 0 to 90."}><input type="number" name="requestDelayDays" min={d.can.advancedRequests ? 0 : 1} max={d.can.advancedRequests ? 90 : 30} defaultValue={s.requestDelayDays} /></Field>
          {d.can.advancedRequests ? (<>
            <Field label="Products per order" hint="Most products in one order that get a request."><input type="number" name="maxProductsPerOrder" min={1} max={10} defaultValue={s.maxProductsPerOrder} /></Field>
            <Field label="Reminder"><label><input type="checkbox" name="reminderEnabled" defaultChecked={s.reminderEnabled} /> Send one reminder if there is no review</label></Field>
            <Field label="Days before the reminder"><input type="number" name="reminderDelayDays" min={3} max={30} defaultValue={s.reminderDelayDays} /></Field>
            <Field label="Products to skip" hint="Product IDs, separated by commas."><input type="text" name="excludedProductIds" defaultValue={s.excludedProductIds} /></Field>
            <Field label="Sender name"><input type="text" name="senderName" defaultValue={s.senderName ?? ""} maxLength={60} /></Field>
            <Field label="Reply-to email"><input type="text" name="replyToEmail" defaultValue={s.replyToEmail ?? ""} /></Field>
          </>) : <s-paragraph>Reminders, product exclusions, sender name and custom email text are part of the Advanced plan.</s-paragraph>}
          <button className="pr-btn primary" name="intent" value="requests" disabled={busy || !d.can.requests}>Save</button>
        </Form>
      </s-section>
      <s-section heading="Email text">
        {!d.can.advancedRequests ? <s-paragraph>Basic uses a standard message with an unsubscribe link. Editing the text is part of the Advanced plan.</s-paragraph> : (["request", "reminder"] as const).map((k) => (
          <Form method="post" key={k}>
            <h3>{k === "request" ? "Review request" : "Reminder"}</h3>
            <input type="hidden" name="kind" value={k.toUpperCase()} />
            <Field label="Subject"><input type="text" name="subject" defaultValue={d[k].subject} maxLength={150} style={{ width: "100%" }} /></Field>
            <Field label="Message" hint="Placeholders: {{customer_name}}, {{product_title}}, {{shop_name}}, {{review_link}} (required), {{unsubscribe_link}}. An unsubscribe link is always added."><textarea name="body" defaultValue={d[k].body} maxLength={5000} /></Field>
            <button className="pr-btn primary" name="intent" value="template" disabled={busy}>Save {k} text</button>
          </Form>))}
      </s-section>
      <s-section heading="Widget appearance">
        {!d.can.widget ? <s-paragraph>The standard widget uses your theme's fonts with a default accent color. Custom colors and layout are part of the Advanced plan.</s-paragraph> : (
          <Form method="post">
            <Field label="Accent color" hint="A hex color like #1f4b3f."><input type="text" name="widgetAccentColor" defaultValue={s.widgetAccentColor} pattern="#[0-9a-fA-F]{6}" /></Field>
            <Field label="Layout"><select name="widgetLayout" defaultValue={s.widgetLayout}><option value="list">List</option><option value="grid">Grid</option></select></Field>
            <button className="pr-btn primary" name="intent" value="widget" disabled={busy}>Save</button>
          </Form>)}
      </s-section>
    </s-page>
  );
}
