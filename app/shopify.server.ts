import "@shopify/shopify-app-react-router/adapters/node";
import { ApiVersion, AppDistribution, shopifyApp } from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server.ts";
import { env } from "./config.server.ts";

const shopify = shopifyApp({
  apiKey: env.shopifyApiKey,
  apiSecretKey: env.shopifyApiSecret,
  // Must match [webhooks].api_version in shopify.app.toml. Verify it is still a supported version before launch.
  apiVersion: "2026-07" as ApiVersion,
  scopes: env.scopes,
  appUrl: env.appUrl,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
});

export default shopify;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const sessionStorage = shopify.sessionStorage;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
