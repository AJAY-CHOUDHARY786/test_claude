// Small Express middleware kept separate from server.js so it can be unit-tested without Express.

/** Replaces any client-supplied X-Client-IP with Express's own answer (which honours the trust-proxy setting).
 *  The app's rate limiters read this header, so it must never come from the caller. */
export function clientIpMiddleware(req, _res, next) {
  req.headers["x-client-ip"] = req.ip || "unknown";
  next();
}

/** Safe defaults. X-Frame-Options and a frame-ancestors CSP are deliberately NOT set here:
 *  Shopify's addDocumentResponseHeaders sets the correct frame-ancestors so the app can load inside the Shopify admin. */
export function securityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
}
