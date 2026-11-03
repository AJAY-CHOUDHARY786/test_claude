# What you must provide or do before launch

**Before first run**
- [ ] Shopify Partner / Dev Dashboard account and a development store
- [ ] PostgreSQL database URL (in `.env`, never in chat)
- [ ] Plans created in Partner Dashboard: `Basic` $9 and `Advanced` $15, each with a 30-day trial (names must match exactly)
- [ ] `npm run db:init` and commit the migration
- [ ] Decide the real app name (change `app/lib/brand.ts`, `name` in `shopify.app.toml`)

**Before real customers**
- [ ] Apply for Shopify's protected customer data access (needed to read customer email on orders)
- [ ] Email provider account, verified sending domain, then set `EMAIL_MODE=resend`, `EMAIL_FROM`, `RESEND_API_KEY` (approve before any real sending)
- [ ] Email event webhook to `/webhooks/email` and `RESEND_WEBHOOK_SECRET` so bounces and complaints are tracked
- [ ] Consider Shopify's `read_all_orders` access if you want verified purchases older than about 60 days
- [ ] Photo storage bucket and `S3_*` variables, if you want photo reviews
- [ ] Hosting for the web server and a second process for `npm run worker`; set `TRUST_PROXY_HOPS` (see `DEPLOYMENT.md`)
- [ ] Backups for the database
- [ ] Run `npm run verify` and `npm audit`; fix findings
- [ ] Test on a dev store: install, billing with test plans, widget on real themes (including mobile), review emails to a test inbox, uninstall, reinstall

**App Store submission**
- [ ] Privacy policy, terms of service, support email (`SUPPORT_EMAIL`), real company details: only you can provide these (facts to give your lawyer are in `COMPLIANCE_FACTS.md`)
- [ ] Have a native speaker check the Spanish, French, German and Hindi storefront text
- [ ] Listing text, screenshots, demo store, review instructions
- [ ] Verify the API version in `shopify.app.toml` and `shopify.server.ts` is still supported
- [ ] Shopify's review and approval (not guaranteed; nothing here claims approval)
