# Feature audit: what is actually done

**TESTED** = an automated test ran and passed in the build environment.
**NOT RUN** = code written and type-checked against stand-in package types, never executed (needs a real database, Shopify, email or storage service).
**MISSING** = not built.

This code was written with no internet access. `npm install` was never run, so Prisma, React Router, Shopify's libraries and
Express were never loaded. Their API usage follows Shopify's documentation and the official template's patterns and must be
confirmed on first run. **Expect to fix small problems the first time you run it.**

## Phase gates
- Phase 0 and 1: complete.
- Phase 2: code written; gate `npm run verify:phase2` **not yet passed** (needs install and build).
- Phase 3: code, constraints, tenant checks and database tests written; offline parts tested; gate `npm run verify:phase3` **not yet passed** (needs a real PostgreSQL test database).

## Tested logic (134 unit tests)
| Feature | Status |
|---|---|
| Plan catalog, entitlements, trial, downgrade, inactive state; Basic blocked from every Advanced feature | TESTED |
| CSV parse/write, import validation with line numbers, duplicates, formula-injection protection | TESTED |
| Review validation and sanitizing, honeypot, no client-set verified status | TESTED |
| Signed tokens (expiry, tamper), email hashing | TESTED |
| Shopify app-proxy signature check | TESTED against the documented algorithm only, not a real Shopify request |
| Email-provider (Svix) webhook signature check | TESTED against the documented algorithm only |
| Email event mapping (delivered, bounced, complained) | TESTED |
| Purchase qualification (paid, not cancelled) | TESTED. The Shopify order lookup itself is NOT RUN |
| Webhook duplicate and retry rules (duplicate ignored, failure returns 500 and releases the claim, success marked done) | TESTED with a fake store; the Shopify signature check and Prisma store are NOT RUN |
| Subscription sync: which Shopify plan wins, unknown names, bad dates | TESTED. The Shopify GraphQL call itself is NOT RUN |
| Orders webhook mapping into review requests, including odd payloads | TESTED |
| Settings forms: Basic cannot save Advanced fields even with a forged form; ranges match the database rules | TESTED |
| Privacy payload parsing: a request with no identifiers never matches every record | TESTED |
| Storefront list parameters and pagination defaults | TESTED |
| Rate limiter, image type/size/key checks, review request planning, send decision, retry backoff | TESTED |
| Structured data, email templates, pagination, analytics maths | TESTED |
| Environment validation, logger redaction, health check, Express middleware | TESTED |
| Storefront translations: 5 languages, same keys and placeholders, every key the script uses is provided | TESTED (translations are machine-written; have a native speaker check them) |
| Prisma schema structure (relations, tenant cascade) | TESTED with a custom checker. **Not validated by Prisma itself** |
| Tenant scoping of every database call (TypeScript-compiler scan; scanner itself tested with bad code) | TESTED |
| 25 database CHECK constraints: every one rejects its bad row by name, schema defaults pass, edges accepted | TESTED on SQLite. **Not run on PostgreSQL** |
| Cross-shop isolation, uniqueness, cascade delete, customer redaction against real PostgreSQL (`test-db/`) | WRITTEN, NOT RUN |

## Storefront widget: TESTED in Chromium (16 browser tests, mocked server)
Rendering, attack text shown as plain text, https-only photos, invalid accent ignored, JSON-LD, load more, sort/filter,
Basic vs Advanced display, form validation and payload, rate-limit message, accessibility basics, questions, mini star rating.
**Not tested:** inside a real Shopify theme, through the real app proxy, on phones, with a screen reader, with real photo upload.

## Server features: NOT RUN
Express server and build · Shopify install and auth wiring · all database services (reviews, moderation, bulk, replies, import, export,
products, questions) · webhooks (uninstall, orders fulfilled/cancelled, subscription update) · the three mandatory privacy webhooks ·
billing sync from Shopify · review request worker (claim, send, retry, reminders) · email sink and Resend adapter ·
email delivery/bounce webhook · photo storage upload and delete · storefront endpoints (list, submit, upload, question) ·
public review page, shareable review links, unsubscribe page · verified-purchase lookup for logged-in customers ·
per-product widget settings.

## Admin pages: NOT RUN
Dashboard, Reviews, Review detail, Products, Questions, Review requests, Import and export, Analytics, Settings, Plans and billing, Help.
Polaris web components and App Bridge usage have not been checked in a real Shopify admin. Mobile layout has not been tested.
Forms use plain HTML controls for reliability.

## Missing or partial
- **Prisma migration files:** not generated. Run `npm run db:init` once.
- **AI-written review summaries:** MISSING by choice. It needs a paid AI service and your approval. The rating summary shown to shoppers is calculated from real reviews.
- **Admin in other languages:** admin is English only. The storefront widget has 5 languages. PARTIAL.
- **Usage limits per plan:** usage is counted, but no limits are enforced because none were specified.
- **Load tests, accessibility audit with assistive technology, dependency audit, ESLint run, penetration test:** not done.
- **Verified purchases older than about 60 days** can't be checked without Shopify's `read_all_orders` access.
- Redis and Kafka: deliberately not used.

## Needs you (cannot be done by code)
Pushing to GitHub, hosting and database accounts, email provider, Shopify Partner setup and plan creation, protected customer data
approval, privacy policy and terms (see `COMPLIANCE_FACTS.md` for the facts), support address, app listing, and Shopify's review.
See `LAUNCH_CHECKLIST.md` and `DEPLOYMENT.md`.
