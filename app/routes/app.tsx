import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { requireMerchant } from "../services/shop.server.ts";
import { env } from "../config.server.ts";
import styles from "../styles/admin.css?url";

export const links = () => [{ rel: "stylesheet", href: styles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireMerchant(request);
  return { apiKey: env.shopifyApiKey };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Dashboard</s-link>
        <s-link href="/app/reviews">Reviews</s-link>
        <s-link href="/app/products">Products</s-link>
        <s-link href="/app/questions">Questions</s-link>
        <s-link href="/app/requests">Review requests</s-link>
        <s-link href="/app/import-export">Import and export</s-link>
        <s-link href="/app/analytics">Analytics</s-link>
        <s-link href="/app/settings">Settings</s-link>
        <s-link href="/app/billing">Plans and billing</s-link>
        <s-link href="/app/help">Help</s-link>
      </s-app-nav>
      <div className="pr"><Outlet /></div>
    </AppProvider>
  );
}

// Shopify's boundary handles auth redirects and error pages correctly for embedded apps.
export function ErrorBoundary() { return boundary.error(useRouteError()); }
export const headers: HeadersFunction = (args) => boundary.headers(args);
