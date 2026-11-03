import { Form, useActionData, useLoaderData, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import styles from "../styles/public.css?url";
import { readUnsubscribeToken } from "../services/links.server.ts";
import { suppressEmail } from "../services/requests.server.ts";
import { publicPageLimiter } from "../services/limiters.server.ts";
import { clientIp } from "../lib/http.ts";

export const links = () => [{ rel: "stylesheet", href: styles }];
export const meta = () => [{ title: "Unsubscribe" }, { name: "robots", content: "noindex" }];

// GET only shows a confirm button, so email scanners that open links cannot unsubscribe people by accident.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const t = new URL(request.url).searchParams.get("t") ?? "";
  return { valid: Boolean(readUnsubscribeToken(t)), t };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (!publicPageLimiter.check(`unsub:${clientIp(request.headers)}`).allowed) return { ok: false };
  const form = await request.formData();
  const grant = readUnsubscribeToken(String(form.get("t") ?? ""));
  if (!grant) return { ok: false };
  await suppressEmail(grant.shopId, grant.email, "unsubscribed");
  return { ok: true };
};

export default function Unsubscribe() {
  const { valid, t } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  if (result?.ok) return <main className="page"><h1>You are unsubscribed</h1><p className="lead">You will not receive any more review requests from this store.</p></main>;
  if (!valid || result?.ok === false) return <main className="page"><h1>This link is not valid</h1><p className="lead">The unsubscribe link has expired or is incorrect. Reply to the email and ask the store to remove you.</p></main>;
  return (
    <main className="page">
      <h1>Stop review requests?</h1>
      <p className="lead">Confirm to stop receiving review request emails from this store.</p>
      <Form method="post"><input type="hidden" name="t" value={t} /><button className="primary" type="submit">Unsubscribe</button></Form>
    </main>
  );
}
