# Test report (build environment)

| Check | Result |
|---|---|
| `node --test test/*.test.ts` | PASS: 134 tests, 0 failures |
| `node test/widget.browser.mjs` (Chromium) | PASS: 16 scenarios |
| Secret scanner on the repository | PASS: no likely secrets; catches a planted database URL |
| Type-check (strict) of pure libraries | PASS |
| Type-check of all app code against stand-in package declarations | PASS (0 errors). Real package types were not available |
| Prisma schema structure check | PASS (19 models, 5 enums); catches a removed back-relation, a bad foreign key and a non-cascading tenant table |
| Negative checks (tests proven able to fail) | Broke redaction, env error messages, `textContent` in the widget, and the schema: each made tests fail |

Bugs found and fixed while testing (the first one would have shown one item per page everywhere):
- A missing `limit` query value was read as 0 and clamped to 1, so every admin list and the storefront widget would have returned a single item.
- A reply write and an answer write looked up by review/question ID without the shop; a review could be linked to another shop's request; an import status update was unscoped.
- The tenant scanner missed raw SQL written as a tagged template and counted `shopId` inside a `select` as proof of scoping.
- Orders webhook: the fulfilment time was read from a field that is not in the payload; it now uses the newest fulfillment, then the update time.
- Earlier: wrong quoting in a CSV test; ambiguous star selector in a widget test; an over-broad
secret-scanner rule; a sort value that widened to `string`; a loader variable typed as `null`; a variable that shadowed `data()`.

## Not run
`npm install`, `prisma validate`, `prisma migrate`, `react-router build`, ESLint, `npm audit`, the Express server, any Shopify
request, any database query, email sending, photo upload, performance or load tests, mobile and screen-reader testing.
