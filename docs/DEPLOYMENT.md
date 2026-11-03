# Deployment guide

Nothing here has been run. Prices and free-tier limits change, so check each provider's current pricing page before choosing.

## What you need to run
| Process | Command | Notes |
|---|---|---|
| Web | `npm start` (Express) | Serves the admin, storefront endpoints and webhooks. Health check: `GET /healthz` |
| Worker | `npm run worker` | Sends review requests, runs imports and cleanup. Run exactly the same image/code as the web process |
| Database | PostgreSQL | Managed service recommended, with automatic backups |
| Release step | `npx prisma migrate deploy` | Run on every deploy before the new version starts |

Any host that can run a Node/Docker web process, a second always-on worker process, and reach PostgreSQL will do. The included `Dockerfile` builds one image for both.

## Environment variables (set in the host's secret settings, never in git)
`NODE_ENV=production`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`, `SHOPIFY_APP_URL` (https), `SHOPIFY_APP_HANDLE`,
`DATABASE_URL`, `LOG_LEVEL`, `TRUST_PROXY_HOPS` (usually `1`), `SUPPORT_EMAIL`.
Email (only when you approve real sending): `EMAIL_MODE=resend`, `EMAIL_FROM`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`.
Photos (optional): `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`.
Use different values for staging and production, including a separate Shopify app, database and storage bucket.

## Steps
1. Create the production database and set `DATABASE_URL`.
2. Deploy the web process and the worker with the same environment. Confirm `GET /healthz` returns `{"status":"ok"}`.
3. Set `application_url`, `redirect_urls` and `[app_proxy] url` in a production Shopify config (for example `shopify.app.production.toml`, created with `shopify app config link`) to your real https address, then run `shopify app deploy`.
4. In your email provider, add a webhook to `https://YOUR-URL/webhooks/email` for delivered, bounced and complained events, and put its signing secret in `RESEND_WEBHOOK_SECRET`.
5. Smoke test on a dev store before any real merchant: install, choose a test plan, add the widget, submit a review, approve it, see it on the storefront, import a CSV, export, uninstall, reinstall.

## Backups and recovery
Turn on automatic backups with your database provider and test a restore once. The app stores nothing important outside PostgreSQL except photos in your bucket.

## Scaling notes
Start with one web process and one worker. If you run several web processes, rate limits are per process (see ARCHITECTURE.md).
Several workers are safe: requests are claimed with row locking.
