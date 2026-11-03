import { handleRequest as handleVercelRequest } from "@vercel/react-router/entry.server";
import type { AppLoadContext, EntryContext } from "react-router";
import { addDocumentResponseHeaders } from "./shopify.server.ts";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext?: AppLoadContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  return handleVercelRequest(request, responseStatusCode, responseHeaders, routerContext, loadContext);
}
