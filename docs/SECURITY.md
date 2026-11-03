# Security notes

| Risk | What the code does | Where |
|---|---|---|
| Forged storefront requests | Verifies Shopify's app-proxy HMAC and timestamp before anything else | `lib/app-proxy.ts`, `services/proxy.server.ts` |
| Forged webhooks | Library verifies the HMAC; duplicate deliveries dropped by webhook ID; failures return 500 so Shopify retries | `services/webhooks.server.ts` |
| One merchant reading another's data | `shopId` in every query; cascading deletes; tenant-column test | `services/*`, `test/server-and-schema.test.ts` |
| Plan bypass | Server checks on every action, endpoint and job; UI only reflects it | `lib/plans.ts`, `denyIfLacking` |
| Fake verified purchases | Verified flag is never read from input; only set from a signed request link | `routes/r.$token.tsx`, `createReview` |
| Script injection (XSS) | Widget uses `textContent` only; emails HTML-escape variables; JSON-LD escapes `<`, `>`, `&`; browser test with attack payloads | `assets/reviews.js`, `lib/email-template.ts`, `lib/structured-data.ts` |
| CSV formula injection | Exported cells starting with `= + - @ tab CR` get a leading apostrophe; imports are never evaluated | `lib/csv.ts` |
| Malicious uploads | Type detected from file bytes; SVG/HTML/executables rejected; 5 MB cap; generated names; per-review upload token valid 15 minutes; cleanup on failure | `lib/media.ts`, `routes/proxy.upload.tsx` |
| Spam and abuse | Honeypot field, per shop+IP rate limits, moderation queue | `routes/proxy.*`, `services/limiters.server.ts` |
| Secrets in logs | Logger masks tokens, passwords, emails, database URLs | `lib/logger.server.ts` |
| Secrets in git | `.gitignore`, secret scanner script, CI step | `scripts/check-secrets.mjs` |
| Email scanners auto-unsubscribing | Unsubscribe link shows a confirm button; only POST unsubscribes | `routes/unsubscribe.tsx` |
| Stored personal data | Email/name removed 90 days after a request finishes; reviews of redacted customers become "Anonymous"; unsubscribe list stores only hashes | `jobs/worker.server.ts`, `services/privacy.server.ts` |
| Forged email-provider events | Svix signature and timestamp verified; duplicates dropped | `lib/svix.ts`, `routes/webhooks.email.tsx` |
| Self-declared "verified" status | Only set from a signed request link or a paid order Shopify confirms for the signed logged-in customer ID | `routes/proxy.submit.tsx`, `lib/purchase.ts` |
| Clickjacking | Left to Shopify's frame-ancestors header; the app must be embeddable | `server/middleware.js` |

## Not covered or not verified
- Nothing here has been penetration-tested. No dependency audit has been run.
- Shopify's "protected customer data" approval is required before order emails can be read in production.
- Rate limits are per instance (see ARCHITECTURE.md).
- Set `TRUST_PROXY_HOPS` correctly for your host or all visitors may share one rate-limit key.
