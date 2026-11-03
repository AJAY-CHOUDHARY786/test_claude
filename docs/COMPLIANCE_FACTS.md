# Data facts for your privacy policy and App Store listing

These are facts about what the app does. They are **not** legal text. You (or a lawyer) must write the privacy policy and terms,
and supply your company name, address and support contact. Nothing here has been reviewed by Shopify.

## Data the app stores
| Data | Why | Kept for |
|---|---|---|
| Shop domain, install state, app settings | Run the app for that store | Until Shopify sends shop/redact (48 hours after uninstall), then deleted |
| Subscription plan and status (read from Shopify) | Apply plan limits | Same |
| Reviews: rating, title, text, display name, verified flag, status, dates | Show reviews | Until the merchant deletes them (then 30 days) or the shop is erased |
| Review photos (files) | Photo reviews | Same as the review |
| Customer first name and email, order ID, product, customer ID (review requests only) | Send review request emails | Email and name removed 90 days after a request finishes, or immediately on a customer erasure request |
| Unsubscribe list: one-way hash of email per shop | Never email people who opted out | Until the shop is erased |
| Questions and answers | Product Q&A | Same as reviews |
| Audit log, usage counts, webhook IDs | Support, safety, de-duplication | Audit and usage until shop erased; webhook IDs 30 days |

The app does **not** collect reviewer email addresses from the storefront widget, and does not store payment details.

## Shopify permissions
`read_orders` (to schedule review requests after fulfilment and to check purchases for "Verified purchase") and `read_products` (product names).
Reading customer name/email from orders needs Shopify's protected customer data approval. With `read_orders` only, Shopify returns roughly the last 60 days of orders, which limits verification of older purchases.

## Privacy webhooks implemented
`customers/data_request` (data collected into the merchant's Help page for download), `customers/redact` (email, name and customer ID removed; reviews shown as "Anonymous"), `shop/redact` (all shop data and photos deleted).

## Third parties involved (you choose them)
Hosting provider, PostgreSQL provider, email provider (customer email and first name are sent to it for review requests), photo storage provider, Shopify.

## Consent and email rules
Every request email has an unsubscribe link and `List-Unsubscribe` headers; unsubscribes and bounces/complaints stop further emails.
Review request emails are off by default and the merchant turns them on. Whether the merchant's marketing consent obligations are met is the merchant's responsibility, and the policy text must tell them so.
