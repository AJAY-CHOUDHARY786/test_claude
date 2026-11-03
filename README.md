# Product Reviews: Shopify review app (PERN stack)

A public, multi-merchant Shopify app for product reviews: collection, moderation, storefront widgets,
review request emails, CSV import/export, analytics, and Basic ($5) and Advanced ($15) plans. Every new install gets 7 days of full app access; a Shopify plan must be approved to continue afterward.

**Stack:** PostgreSQL (Prisma) · Express · React (React Router, Polaris web components) · Node.js 22. TypeScript throughout.
No Python and no other runtime is needed.

> **Read `docs/STATUS.md` first.** It lists exactly what was tested and what was not. This code was written
> without internet access, so it has never been run against real Shopify, a real database, or a real email service.
> Expect to fix small problems the first time you run it.

## What you need
- Node.js 22, Git, the Shopify CLI (`npm install -g @shopify/cli`)
- A Shopify Partner (or Dev Dashboard) account and a **development store**
- A PostgreSQL database (local, or a free tier from a provider such as Neon or Supabase)

## First run (about 30 minutes)
1. `npm install`
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL` (your Postgres address). Never commit `.env` and never paste its contents into chat.
3. Link the app: `shopify app config link` (creates the app in your Partner account and fills in `client_id`).
4. Create the first database migration (only needed once): `npm run db:init`, then commit the new `prisma/migrations` folder.
5. Create your plans in the Partner Dashboard (App pricing): **Basic** $9/month and **Advanced** $15/month, each with a **30-day free trial**. The plan names must be exactly `Basic` and `Advanced`. Put your app's handle in `SHOPIFY_APP_HANDLE`.
6. `npm run dev` (starts the app and a tunnel; choose your dev store and install).
7. In a second terminal: `npm run worker` (sends review requests and runs imports).
8. In the dev store's theme editor, open a product page and add the **Product reviews** block (Apps section).

## Everyday commands
| Command | What it does |
|---|---|
| `npm run verify` | schema check, tests, secret scan, type-check, lint and build in one go |
| `npm test` | 134 unit tests (Node's built-in runner) |
| `npm run test:widget` | 16 browser tests of the storefront widget (needs Playwright's Chromium) |
| `npm run check:secrets` | scans for accidentally committed keys |
| `npm run check:tenant` | fails if any database query on merchant data is not scoped by shop |
| `npm run verify:phase2` / `npm run verify:phase3` | phase gates: run every check for that phase and write a masked report |
| `npm run test:db` | tenant-isolation and integrity tests on a real PostgreSQL **test** database (`DATABASE_URL_TEST`) |
| `npm run build` then `npm start` | production server (Express) |
| `npm run worker` | background worker (review requests, imports, cleanup) |

## Email delivery tracking (optional)
In Resend, add a webhook to `https://YOUR-URL/webhooks/email` for delivered, bounced and complained events and put its signing secret in `RESEND_WEBHOOK_SECRET`. Bounces and complaints then stop further emails to that address.

## Safety defaults
- **Emails are not sent** until you set `EMAIL_MODE=resend` with a provider key. The default only logs.
- **Review requests are off** per store until the merchant turns them on.
- **Photo uploads are off** until all `S3_*` variables are set.
- Structured data (search-result stars) is off per store until the merchant turns it on.

## Where things are
- `app/lib/` pure, tested logic (plans, CSV, validation, signatures, scheduling, templates)
- `app/services/` database and Shopify code, always scoped by shop
- `app/routes/` admin pages (`app.*`), storefront endpoints (`proxy.*`), webhooks (`webhooks.*`), public pages (`r.$token`, `unsubscribe`)
- `app/jobs/` background worker
- `extensions/review-widgets/` theme app extension (storefront widget)
- `server.js` Express production server · `prisma/schema.prisma` database
- `docs/` architecture, feature matrix, security, status, test report, deployment, compliance facts, launch checklist
- `Dockerfile` one image for the web and worker processes (untested)
