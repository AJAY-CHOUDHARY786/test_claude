// Production web server: Node + Express in front of the React Router app.
// Start with `npm run build` then `npm start`. Development uses `shopify app dev` (Vite).
import compression from "compression";
import express from "express";
import { createRequestHandler } from "@react-router/express";
import { clientIpMiddleware, securityHeaders } from "./server/middleware.js";

const port = Number(process.env.PORT || 3000);
const app = express();

app.disable("x-powered-by");
// Number of proxies in front of this server (your host's load balancer is usually 1). Needed for correct client IPs.
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));
app.use(compression());
app.use(securityHeaders);
app.use(clientIpMiddleware);

// Hashed build assets can be cached for a year; everything else for an hour.
app.use("/assets", express.static("build/client/assets", { immutable: true, maxAge: "1y" }));
app.use(express.static("build/client", { maxAge: "1h" }));

// Do NOT add express.json()/urlencoded() here: React Router reads request bodies itself and Shopify webhook
// signatures are computed over the raw body.
app.use(createRequestHandler({ build: () => import("./build/server/index.js") }));

const server = app.listen(port, () => console.log(JSON.stringify({ level: "info", msg: "Server listening", port })));
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    console.log(JSON.stringify({ level: "info", msg: "Server shutting down", signal: sig }));
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
