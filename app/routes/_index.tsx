import { redirect, type LoaderFunctionArgs } from "react-router";
import { APP_NAME } from "../lib/brand.ts";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) throw redirect(`/app?${url.searchParams.toString()}`);
  return null;
};

export default function Index() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 520, margin: "4rem auto", padding: "0 1rem", lineHeight: 1.5 }}>
      <h1>{APP_NAME}</h1>
      <p>This app runs inside your Shopify admin. Install it from the Shopify App Store or open it from your store's Apps menu.</p>
    </main>
  );
}
