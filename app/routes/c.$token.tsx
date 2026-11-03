import { useActionData, useLoaderData, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import prisma from "../db.server.ts";
import styles from "../styles/public.css?url";
import { readCollectToken } from "../services/links.server.ts";
import { getEntitlements } from "../services/billing.server.ts";
import { productTitle } from "../services/products.server.ts";
import { createReview } from "../services/reviews.server.ts";
import { publicPageLimiter } from "../services/limiters.server.ts";
import { validateReviewSubmission } from "../lib/review-validation.ts";
import { hasFeature } from "../lib/plans.ts";
import { clientIp } from "../lib/http.ts";
import { ReviewFormPage, ThanksPage } from "../components/ReviewFormPage.tsx";

export const links = () => [{ rel: "stylesheet", href: styles }];
export const meta = () => [{ title: "Write a review" }, { name: "robots", content: "noindex" }];

async function resolve(token: string | undefined) {
  const grant = token ? readCollectToken(token) : null;
  if (!grant) return null;
  const shop = await prisma.shop.findUnique({ where: { id: grant.shopId }, include: { settings: true } });
  return shop && !shop.uninstalledAt ? { shop, productId: grant.productId } : null;
}

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const r = await resolve(params.token);
  if (!r) return { valid: false as const, productTitle: "" };
  return { valid: true as const, productTitle: (await productTitle(r.shop.domain, r.productId)) ?? "purchase" };
};

// Reviews from a shared link are never marked as verified purchases.
export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (!publicPageLimiter.check(`collect:${clientIp(request.headers)}`).allowed) return { errors: { form: "Too many attempts. Please try again later." } };
  const r = await resolve(params.token);
  if (!r) return { errors: { form: "This review link is no longer valid." } };
  const form = Object.fromEntries(await request.formData());
  const result = validateReviewSubmission({ ...form, productId: r.productId });
  if (!result.ok) return result.bot ? { done: true } : { errors: result.errors };
  if (!hasFeature(await getEntitlements(r.shop.id), "storefront.collect")) return { errors: { form: "Reviews are not being accepted right now." } };
  const review = await createReview(r.shop.id, result.value, { verified: false, autoPublish: r.shop.settings?.autoPublish ?? false, source: "LINK" });
  return review === "duplicate" ? { errors: { form: "That review was already submitted." } } : { done: true };
};

export default function CollectPage() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as { done?: boolean; errors?: Record<string, string> } | undefined;
  if (result?.done) return <ThanksPage />;
  if (!data.valid) return <main className="page"><h1>This link is not valid</h1><p className="lead">The review link has expired or is incorrect.</p></main>;
  return <ReviewFormPage productTitle={data.productTitle} defaultName="" errors={result?.errors ?? {}} />;
}
