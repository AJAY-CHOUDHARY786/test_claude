# Architecture

```
 Merchant (Shopify admin, embedded)        Shopper (storefront)
        |                                        |
  React + Polaris web components        Theme app extension (blocks + JS)
        |                                        |  /apps/reviews/*  (signed by Shopify)
        v                                        v
 +---------------- Express server (server.js) ----------------+
 |  React Router app: admin routes, /proxy/* , /webhooks/* ,   |
 |  public pages (/r/:token, /unsubscribe, /healthz)           |
 +--------------------------+----------------------------------+
                            |                    ^
                            v                    | webhooks (HMAC verified)
                       PostgreSQL <---- Worker (app/jobs) ----> Email provider (Resend or sink)
                            |                              \--> S3-compatible storage (photos)
                  Shopify Admin GraphQL (subscription status, product titles)
```

## Decisions
- **PERN:** PostgreSQL, Express, React, Node. Express serves the built React Router app in production.
- **Billing:** Shopify-hosted pricing. The app never creates charges. It reads subscription state from Shopify.
- **Entitlements:** one server-side module (`app/lib/plans.ts`).
- **Queue:** the database. Review requests are claimed with `FOR UPDATE SKIP LOCKED` so several workers cannot send the same email. No Redis or Kafka: nothing measured needs them.
- **Tenancy:** every merchant-owned table has `shopId` with cascading delete from `Shop`; every service function takes `shopId` and puts it in every query. `shop/redact` deletes the `Shop` row and everything follows.
- **Storefront:** the widget calls the app through Shopify's app proxy. Every request is signature-checked and the shop comes from the signed query.
- **Verified purchase:** set only when a review is written from a signed link in a review request email, which exists only for a real fulfilled order.

## Known limits
- Rate limiting is in memory, per server instance. With several instances, move it to the database or Redis.
- Storefront list responses are cached for 60 seconds.
- Exports and imports are capped at 20,000 rows and 5 MB per file.
- Customer data-request results are delivered through the app's Help page.
