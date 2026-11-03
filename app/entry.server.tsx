import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter, type EntryContext } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { type RenderToPipeableStreamOptions } from "react-dom/server";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server.ts";

export const streamTimeout = 5000;

export default async function handleRequest(request: Request, responseStatusCode: number, responseHeaders: Headers, reactRouterContext: EntryContext) {
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";

  return new Promise<Response>((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(<ServerRouter context={reactRouterContext} url={request.url} />, {
      [callbackName]: () => {
        const body = new PassThrough();
        const stream = createReadableStreamFromReadable(body);
        responseHeaders.set("Content-Type", "text/html");
        resolve(new Response(stream, { headers: responseHeaders, status: responseStatusCode }));
        pipe(body);
      },
      onShellError(error: unknown) { reject(error); },
      onError(error: unknown) { responseStatusCode = 500; console.error(error); },
    } as RenderToPipeableStreamOptions);
    setTimeout(abort, streamTimeout + 1000);
  });
}
