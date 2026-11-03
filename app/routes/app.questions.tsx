import { data, Form, useActionData, useLoaderData, useNavigation, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import prisma from "../db.server.ts";
import { denyIfLacking, requireMerchant } from "../services/shop.server.ts";
import { sanitizeText } from "../lib/review-validation.ts";
import { hasFeature } from "../lib/plans.ts";
import { parsePagination } from "../lib/pagination.ts";
import { Locked, Notice, Pager, StatusBadge, fmtDate } from "../components/ui.tsx";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, ent } = await requireMerchant(request);
  if (!hasFeature(ent, "qa.manage")) return { locked: true as const };
  const url = new URL(request.url);
  const status = ["PENDING", "PUBLISHED", "HIDDEN"].includes(url.searchParams.get("status") ?? "") ? (url.searchParams.get("status") as "PENDING" | "PUBLISHED" | "HIDDEN") : undefined;
  const page = parsePagination(url.searchParams);
  const where = { shopId: shop.id, ...(status ? { status } : {}) };
  const [items, total] = await Promise.all([prisma.question.findMany({ where, include: { answer: true }, orderBy: { createdAt: "desc" }, skip: page.skip, take: page.limit }), prisma.question.count({ where })]);
  return { locked: false as const, items: items.map((q) => ({ id: q.id, productId: q.shopifyProductId, body: q.body, name: q.askerName, status: q.status, createdAt: q.createdAt, answer: q.answer?.body ?? "" })), total, page: page.page, limit: page.limit };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, ent } = await requireMerchant(request);
  const denied = denyIfLacking(ent, "qa.manage");
  if (denied) return denied;
  const f = await request.formData();
  const id = String(f.get("id") ?? "");
  const q = await prisma.question.findFirst({ where: { id, shopId: shop.id } });
  if (!q) return data({ error: "Question not found" }, { status: 404 });
  const intent = String(f.get("intent") ?? "");
  if (intent === "answer") {
    const body = sanitizeText(String(f.get("answer") ?? ""), 2000);
    if (!body) return data({ error: "Write an answer first" }, { status: 422 });
    await prisma.$transaction([
      prisma.answer.deleteMany({ where: { questionId: q.id, shopId: shop.id } }),
      prisma.answer.create({ data: { shopId: shop.id, questionId: q.id, body } }),
      prisma.question.updateMany({ where: { id: q.id, shopId: shop.id }, data: { status: "PUBLISHED" } }),
    ]);
    return { message: "Answer published" };
  }
  if (intent === "hide" || intent === "delete") {
    if (intent === "delete") await prisma.question.deleteMany({ where: { id: q.id, shopId: shop.id } });
    else await prisma.question.updateMany({ where: { id: q.id, shopId: shop.id }, data: { status: "HIDDEN" } });
    return { message: intent === "delete" ? "Question deleted" : "Question hidden" };
  }
  return data({ error: "Unknown action" }, { status: 400 });
};

export default function Questions() {
  const d = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as { message?: string; error?: string } | undefined;
  const busy = useNavigation().state !== "idle";
  if (d.locked) return <s-page heading="Questions"><Locked what="Questions and answers" plan="Basic" /></s-page>;
  return (
    <s-page heading="Questions and answers">
      <Notice data={result} />
      <s-section>
        <Form method="get" className="pr-toolbar"><label>Status<select name="status"><option value="">All</option><option value="PENDING">Pending</option><option value="PUBLISHED">Published</option><option value="HIDDEN">Hidden</option></select></label><button className="pr-btn">Filter</button></Form>
        {d.items.length === 0 ? <s-paragraph>No questions yet. Shoppers can ask questions from the review widget on product pages.</s-paragraph> : d.items.map((q) => (
          <Form method="post" key={q.id} style={{ borderBottom: "1px solid #e3e5e7", padding: "12px 0" }}>
            <input type="hidden" name="id" value={q.id} />
            <div className="pr-row"><strong>{q.body}</strong><StatusBadge status={q.status} /></div>
            <div className="pr-muted">{q.name} · product {q.productId} · {fmtDate(q.createdAt)}</div>
            <div className="pr-field"><textarea name="answer" defaultValue={q.answer} placeholder="Write your answer" maxLength={2000} aria-label={`Answer to: ${q.body}`} /></div>
            <div className="pr-row"><button className="pr-btn primary" name="intent" value="answer" disabled={busy}>Publish answer</button><button className="pr-btn" name="intent" value="hide" disabled={busy}>Hide</button><button className="pr-btn danger" name="intent" value="delete" disabled={busy}>Delete</button></div>
          </Form>))}
        <Pager total={d.total} page={d.page} limit={d.limit} />
      </s-section>
    </s-page>
  );
}
