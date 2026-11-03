import { Form, Link, redirect, useActionData, useLoaderData, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import prisma from "../db.server.ts";
import { denyIfLacking, getProductTitles, requireMerchant } from "../services/shop.server.ts";
import { deleteReply, editReview, getReview, isModerationAction, moderateReview, replyToReview, softDeleteReview } from "../services/reviews.server.ts";
import { getStorage } from "../services/storage.server.ts";
import { hasFeature } from "../lib/plans.ts";
import { Field, Locked, Notice, Stars, StatusBadge, fmtDate } from "../components/ui.tsx";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, shop, ent } = await requireMerchant(request);
  if (!hasFeature(ent, "reviews.manage")) return { locked: true as const };
  const review = params.id ? await getReview(shop.id, params.id) : null;
  if (!review) throw new Response("Review not found", { status: 404 });
  const titles = await getProductTitles(admin, [review.shopifyProductId]);
  const storage = await getStorage();
  return {
    locked: false as const,
    review: { id: review.id, rating: review.rating, title: review.title, body: review.body, name: review.reviewerName, status: review.status, verified: review.verifiedPurchase, source: review.source, createdAt: review.createdAt, reply: review.reply?.body ?? "", productId: review.shopifyProductId },
    product: titles.get(review.shopifyProductId) ?? `Product ${review.shopifyProductId}`,
    photos: review.media.map((m) => ({ id: m.id, url: storage ? storage.publicUrl(m.storageKey) : null })),
    events: review.events.map((e) => ({ id: e.id, action: e.action, actor: e.actor, createdAt: e.createdAt, toStatus: e.toStatus })),
    canModerate: hasFeature(ent, "reviews.moderate"), canReply: hasFeature(ent, "reviews.reply"),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { shop, ent, actor } = await requireMerchant(request);
  const id = params.id!;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const need = intent === "reply" || intent === "delete_reply" ? "reviews.reply" : "reviews.moderate";
  const denied = denyIfLacking(ent, need);
  if (denied) return denied;

  if (isModerationAction(intent)) {
    const r = await moderateReview(shop.id, id, intent, actor, String(form.get("note") ?? "") || undefined);
    return r ? { message: "Status updated" } : { error: "Review not found" };
  }
  switch (intent) {
    case "edit": {
      const ok = await editReview(shop.id, id, { title: String(form.get("title") ?? "") || null, body: String(form.get("body") ?? ""), reviewerName: String(form.get("name") ?? "") }, actor);
      return ok ? { message: "Review saved" } : { error: "Enter a name and some review text" };
    }
    case "reply": return (await replyToReview(shop.id, id, String(form.get("reply") ?? ""), actor)) ? { message: "Reply saved" } : { error: "Write a reply first" };
    case "delete_reply": await deleteReply(shop.id, id, actor); return { message: "Reply removed" };
    case "remove_photo": {
      const photoId = String(form.get("photoId") ?? "");
      const media = await prisma.reviewMedia.findFirst({ where: { id: photoId, reviewId: id, shopId: shop.id } });
      if (!media) return { error: "Photo not found" };
      const storage = await getStorage();
      if (storage) await storage.remove(media.storageKey).catch(() => undefined);
      await prisma.reviewMedia.deleteMany({ where: { id: media.id, shopId: shop.id } });
      return { message: "Photo removed" };
    }
    case "delete": await softDeleteReview(shop.id, id, actor); throw redirect("/app/reviews");
    default: return { error: "Unknown action" };
  }
};

export default function ReviewDetail() {
  const d = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as { message?: string; error?: string } | undefined;
  if (d.locked) return <s-page heading="Review"><Locked what="Review management" plan="Basic" /></s-page>;
  const r = d.review;
  return (
    <s-page heading="Review details">
      <Link to="/app/reviews" className="pr-btn">Back to reviews</Link>
      <Notice data={result} />
      <s-section heading={d.product}>
        <div className="pr-row"><Stars n={r.rating} /><StatusBadge status={r.status} />{r.verified && <s-badge tone="success">Verified purchase</s-badge>}<span className="pr-muted">{fmtDate(r.createdAt)} · {r.source.toLowerCase()}</span></div>
        {d.photos.length > 0 && (
          <div className="pr-photos" style={{ marginTop: 12 }}>
            {d.photos.map((p) => (
              <Form method="post" key={p.id}>
                <input type="hidden" name="photoId" value={p.id} />
                {p.url ? <img src={p.url} alt="Customer photo" loading="lazy" /> : <span className="pr-muted">Photo (storage not configured)</span>}
                <div><button className="pr-btn danger" name="intent" value="remove_photo" disabled={!d.canModerate}>Remove</button></div>
              </Form>
            ))}
          </div>
        )}
      </s-section>
      <s-section heading="Moderation">
        <Form method="post" className="pr-row">
          {r.status !== "PUBLISHED" && <button className="pr-btn primary" name="intent" value="approve" disabled={!d.canModerate}>Approve and publish</button>}
          {r.status === "PUBLISHED" && <button className="pr-btn" name="intent" value="hide" disabled={!d.canModerate}>Hide from store</button>}
          {r.status === "PENDING" && <button className="pr-btn" name="intent" value="reject" disabled={!d.canModerate}>Reject</button>}
          {r.status === "HIDDEN" && <button className="pr-btn" name="intent" value="restore" disabled={!d.canModerate}>Restore</button>}
          {r.status !== "PENDING" && <button className="pr-btn" name="intent" value="unpublish" disabled={!d.canModerate}>Move back to pending</button>}
        </Form>
      </s-section>
      <s-section heading="Edit review">
        <Form method="post">
          <Field label="Name shown"><input type="text" name="name" defaultValue={r.name} maxLength={60} required /></Field>
          <Field label="Headline"><input type="text" name="title" defaultValue={r.title ?? ""} maxLength={120} /></Field>
          <Field label="Review text"><textarea name="body" defaultValue={r.body} maxLength={5000} required /></Field>
          <button className="pr-btn primary" name="intent" value="edit" disabled={!d.canModerate}>Save changes</button>
        </Form>
      </s-section>
      <s-section heading="Your reply">
        <Form method="post">
          <Field label="Public reply" hint="Shown under the review on your store."><textarea name="reply" defaultValue={r.reply} maxLength={2000} /></Field>
          <div className="pr-row">
            <button className="pr-btn primary" name="intent" value="reply" disabled={!d.canReply}>Save reply</button>
            {r.reply && <button className="pr-btn danger" name="intent" value="delete_reply" disabled={!d.canReply}>Remove reply</button>}
          </div>
        </Form>
      </s-section>
      <s-section heading="History">
        {d.events.length === 0 ? <s-paragraph>No activity yet.</s-paragraph> : (
          <ul>{d.events.map((e) => <li key={e.id}>{fmtDate(e.createdAt)}: {e.action.replace(/_/g, " ")}{e.toStatus ? ` → ${e.toStatus.toLowerCase()}` : ""} <span className="pr-muted">({e.actor.replace(/^merchant:.*/, "merchant")})</span></li>)}</ul>
        )}
      </s-section>
      <s-section heading="Delete">
        <s-paragraph>Deleted reviews are removed from your store immediately and permanently erased after 30 days.</s-paragraph>
        <Form method="post" onSubmit={(e) => { if (!confirm("Delete this review?")) e.preventDefault(); }}>
          <button className="pr-btn danger" name="intent" value="delete" disabled={!d.canModerate}>Delete review</button>
        </Form>
      </s-section>
    </s-page>
  );
}
