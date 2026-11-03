import { useActionData, useLoaderData, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import prisma from "../db.server.ts";
import styles from "../styles/public.css?url";
import { readReviewToken } from "../services/links.server.ts";
import { getEntitlements } from "../services/billing.server.ts";
import { createReview } from "../services/reviews.server.ts";
import { publicPageLimiter } from "../services/limiters.server.ts";
import { validateReviewSubmission } from "../lib/review-validation.ts";
import { hasFeature } from "../lib/plans.ts";
import { clientIp } from "../lib/http.ts";
import { ReviewFormPage, ThanksPage } from "../components/ReviewFormPage.tsx";

export const links = () => [{ rel: "stylesheet", href: styles }];
export const meta = () => [{ title: "Write a review" }, { name: "robots", content: "noindex" }];

async function resolve(token: string | undefined) {
  const requestId = token ? readReviewToken(token) : null;
  if (!requestId) return { state: "invalid" as const };
  const req = await prisma.reviewRequest.findUnique({ where: { id: requestId }, include: { shop: { include: { settings: true } }, review: { select: { id: true } } } });
  if (!req || req.shop.uninstalledAt) return { state: "invalid" as const };
  if (req.review || req.status === "COMPLETED") return { state: "done" as const };
  if (req.status === "CANCELLED") return { state: "invalid" as const };
  return { state: "open" as const, req };
}

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const r = await resolve(params.token);
  if (r.state !== "open") return { state: r.state, productTitle: "", name: "" };
  return { state: "open" as const, productTitle: r.req.productTitle, name: r.req.recipientName ?? "" };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (!publicPageLimiter.check(`${params.token?.slice(0, 20)}:${clientIp(request.headers)}`).allowed) return { errors: { form: "Too many attempts. Please try again later." } };
  const r = await resolve(params.token);
  if (r.state !== "open") return { errors: { form: "This review link is no longer valid." } };
  const form = Object.fromEntries(await request.formData());
  // The product comes from the server-side request record, never from the form.
  const result = validateReviewSubmission({ ...form, productId: r.req.shopifyProductId });
  if (!result.ok) return result.bot ? { done: true } : { errors: result.errors };
  const ent = await getEntitlements(r.req.shopId);
  if (!hasFeature(ent, "storefront.collect")) return { errors: { form: "Reviews are not being accepted right now." } };
  const review = await createReview(r.req.shopId, result.value, { verified: true, requestId: r.req.id, autoPublish: r.req.shop.settings?.autoPublish ?? false, source: "REQUEST" });
  if (review === "duplicate") return { errors: { form: "A review has already been submitted from this link." } };
  return { done: true };
};

export default function ReviewPage() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as { done?: boolean; errors?: Record<string, string> } | undefined;
  if (result?.done || data.state === "done") return <ThanksPage />;
  if (data.state === "invalid") return <main className="page"><h1>This link has expired</h1><p className="lead">The review link is no longer valid. If you would still like to leave a review, visit the product page on the store.</p></main>;
  return <ReviewFormPage productTitle={data.productTitle} defaultName={data.name} errors={result?.errors ?? {}} />;
}
