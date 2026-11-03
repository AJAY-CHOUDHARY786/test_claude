# Plan feature matrix

Source of truth: `app/lib/plans.ts`. The server checks these on every route, action, storefront endpoint and background job.

| Feature | Basic $5 | Advanced $15 |
|---|:-:|:-:|
| 7-day free trial | Yes | Yes |
| Review management (list, search, filter, edit, delete) | Yes | Yes |
| Approve / reject / hide reviews, merchant replies | Yes | Yes |
| Show reviews on the store (standard widgets, star rating block) | Yes | Yes |
| Collect reviews from shoppers, photo reviews | Yes | Yes |
| Product questions and answers | Yes | Yes |
| Per-product review totals and shareable review links | Yes | Yes |
| Verified purchase badge (review email link, or logged-in customer with a paid order) | Yes | Yes |
| Automatic review request emails (default text, 1 to 30 day delay) | Yes | Yes |
| CSV import and export | Yes | Yes |
| Basic analytics (totals, average, distribution, request status) | Yes | Yes |
| Widget colors and layout | No | Yes |
| Advanced analytics (weekly trend, top products, verified share) | No | Yes |
| Reminders, custom email text, sender name, product exclusions, send-now, 0 to 90 day delay | No | Yes |
| Widget sorting and star-rating filters | No | Yes |
| Hide or restyle the widget for individual products | No | Yes |
| Bulk moderation | No | Yes |

## No active subscription
Published reviews keep showing on the storefront and merchants can still export their data. Everything else is paused. Nothing is deleted.

## Downgrade, cancel, billing failure
Shopify sends `app_subscriptions/update`; the app re-reads the subscription from Shopify and the new limits apply immediately,
including to queued review requests and running imports.
