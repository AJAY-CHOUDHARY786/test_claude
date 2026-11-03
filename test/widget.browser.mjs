// Runs the real storefront widget in headless Chromium against a mocked app proxy.
// Usage: node test/widget.browser.mjs   (needs the `playwright` package and a Chromium install)
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require(process.env.PLAYWRIGHT_PATH ?? "/home/claude/.npm-global/lib/node_modules/playwright"); }

const JS = readFileSync(new URL("../extensions/review-widgets/assets/reviews.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../extensions/review-widgets/assets/reviews.css", import.meta.url), "utf8");
const STRINGS = JSON.stringify({ none: "No reviews yet.", based_on: "Based on {count} reviews", based_on_one: "Based on 1 review", verified: "Verified purchase", store_reply: "Reply from the store", write: "Write a review", cancel: "Cancel", sort: "Sort by", newest: "Newest", highest: "Highest", lowest: "Lowest", all_ratings: "All ratings", load_more: "Show more reviews", your_rating: "Your rating", headline: "Headline", your_review: "Your review", your_name: "Name", photos: "Photos", submit: "Submit review", sending: "Sending…", thanks_pending: "Thanks, pending approval.", thanks_published: "Thanks, published.", error_generic: "Something went wrong.", error_rate: "Too many reviews.", photo_failed: "Photo failed.", questions: "Questions", ask: "Ask a question", your_question: "Your question", thanks_question: "Thanks for asking.", stars: "{n} out of 5 stars", loading: "Loading…" });
const PAGE = (extra = "") => `<!doctype html><html><head><title>t</title></head><body>
<div class="prw" data-prw data-product-id="123" data-endpoint="/apps/reviews" data-heading="Customer reviews" data-show-form="true" data-show-questions="true" id="prw-1"></div>
<script type="application/json" data-prw-strings>${STRINGS}</script>${extra}
<style>${CSS}</style><script src="/reviews.js"></script></body></html>`;

const XSS_BODY = `<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>`;
const summary = { total: 3, average: 4.33, distribution: [5, 4, 3, 2, 1].map((r) => ({ rating: r, count: r === 5 ? 2 : r === 3 ? 1 : 0, percent: r === 5 ? 67 : r === 3 ? 33 : 0 })) };
const reviewsP1 = [
  { id: "a", rating: 5, title: `<b>Title</b>`, body: XSS_BODY, name: `<i>Eve</i>`, verified: true, date: "2026-01-02", reply: { body: "<u>Thanks</u>" }, photos: ["https://cdn.example.com/a.jpg", "javascript:alert(1)", "http://insecure.example.com/b.jpg", "data:text/html,x"] },
  { id: "b", rating: 3, title: null, body: "Okay product", name: "Sam", verified: false, date: "2026-01-01", reply: null, photos: [] },
];
const base = (over = {}) => ({ summary, reviews: reviewsP1, page: 1, hasMore: true, settings: { accent: "#123456", layout: "grid", showVerified: true, perPage: 10, canSubmit: true, canAsk: true, advancedDisplay: true, allowPhotos: false }, questions: [{ question: "<b>Does it fit?</b>", asker: "Al", answer: "Yes <script>" }], jsonLd: JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: "P" }), ...over });

async function run(name, fn, opts = {}) {
  const browser = await pw.chromium.launch();
  const page = await browser.newPage();
  const calls = [];
  await page.route("https://shop.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/reviews.js") return route.fulfill({ contentType: "text/javascript", body: JS });
    if (url.pathname.startsWith("/apps/reviews/")) {
      calls.push({ path: url.pathname, params: Object.fromEntries(url.searchParams), method: route.request().method(), body: route.request().postData() });
      const handler = opts.api?.(url, route.request());
      if (handler) return route.fulfill({ contentType: "application/json", ...handler });
      const page2 = url.searchParams.get("page") === "2";
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(page2 ? base({ reviews: [{ id: "c", rating: 4, title: "Page two", body: "Second page", name: "Zed", verified: false, date: "2026-01-03", reply: null, photos: [] }], page: 2, hasMore: false }) : (opts.data ?? base())) });
    }
    return route.fulfill({ contentType: "text/html", body: PAGE(opts.extra ?? "") });
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("https://shop.test/products/x");
  try { await fn(page, calls); assert.deepEqual(errors, [], "no page errors"); console.log(`PASS  ${name}`); }
  catch (e) { console.log(`FAIL  ${name}\n      ${e.message.split("\n")[0]}`); process.exitCode = 1; }
  finally { await browser.close(); }
}
const ready = (page) => page.waitForSelector(".prw-item");

await run("renders summary, reviews and applies safe styling", async (page) => {
  await ready(page);
  assert.equal(await page.locator(".prw-item").count(), 2);
  assert.match(await page.locator(".prw-score").innerText(), /4\.33/);
  assert.match(await page.locator(".prw-summary").innerText(), /Based on 3 reviews/);
  assert.equal(await page.locator("#prw-1").getAttribute("data-layout"), "grid");
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#prw-1")).getPropertyValue("--prw-accent").trim()), "#123456");
  assert.match(await page.locator(".prw-badge").first().innerText(), /Verified purchase/);
});

await run("review text is shown as text: HTML and scripts in reviews never execute", async (page) => {
  await ready(page);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.equal(await page.locator(".prw-body img, .prw-item img[src=x], .prw-item b, .prw-item i, .prw-reply u").count(), 0);
  assert.ok((await page.locator(".prw-item").first().innerText()).includes("<img src=x"));
  assert.ok((await page.locator(".prw-item h3").first().innerText()).includes("<b>Title</b>"));
  assert.ok((await page.locator(".prw-q").innerText()).includes("<b>Does it fit?</b>"));
});

await run("only https photo URLs are rendered", async (page) => {
  await ready(page);
  const srcs = await page.locator(".prw-photos img").evaluateAll((els) => els.map((e) => e.getAttribute("src")));
  assert.deepEqual(srcs, ["https://cdn.example.com/a.jpg"]);
});

await run("an invalid accent color from the server is ignored", async (page) => {
  await ready(page);
  const v = await page.evaluate(() => document.querySelector("#prw-1").style.getPropertyValue("--prw-accent"));
  assert.equal(v, "");
}, { data: base({ settings: { ...base().settings, accent: "red;background:url(//evil)" } }) });

await run("JSON-LD is inserted once as inert text", async (page) => {
  await ready(page);
  assert.equal(await page.locator('script[type="application/ld+json"]').count(), 1);
  assert.equal(JSON.parse(await page.locator('script[type="application/ld+json"]').textContent()).name, "P");
});

await run("load more requests the next page and appends", async (page, calls) => {
  await ready(page);
  await page.getByRole("button", { name: "Show more reviews" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".prw-item").length === 3);
  assert.ok(calls.some((c) => c.params.page === "2"));
  assert.equal(await page.getByRole("button", { name: "Show more reviews" }).isHidden(), true);
});

await run("sorting and star filters are sent to the server on the Advanced plan", async (page, calls) => {
  await ready(page);
  await page.locator("select").selectOption("highest");
  await page.waitForFunction(() => true);
  await page.waitForTimeout(150);
  assert.ok(calls.some((c) => c.params.sort === "highest"));
  await page.locator(".prw-dist button").first().click();
  await page.waitForTimeout(150);
  assert.ok(calls.some((c) => c.params.rating === "5"));
});

await run("Basic plan: no sort control and no star filter buttons", async (page) => {
  await ready(page);
  assert.equal(await page.locator("select").count(), 0);
  assert.equal(await page.locator(".prw-dist button").count(), 0);
}, { data: base({ settings: { ...base().settings, advancedDisplay: false } }) });

await run("form: server validation errors are shown next to the fields", async (page) => {
  await ready(page);
  await page.getByRole("button", { name: "Write a review" }).click();
  await page.getByRole("button", { name: "Submit review" }).click();
  await page.waitForSelector(".prw-err:not([hidden])");
  assert.match(await page.locator(".prw-err:not([hidden])").first().innerText(), /rating|few words|name/i);
}, { api: (url, _req) => (url.pathname.endsWith("/submit") ? { status: 422, body: JSON.stringify({ ok: false, errors: { rating: "Choose a rating from 1 to 5 stars", body: "Write at least a few words", name: "Enter a name" } }) } : null) });

await run("form: sends only review fields (no way to claim verified) and shows the thank-you", async (page, calls) => {
  await ready(page);
  await page.getByRole("button", { name: "Write a review" }).click();
  await page.locator("label[for$='-4']").click();
  await page.fill("textarea[name=body]", "Really good");
  await page.fill("input[name=name]", "Pat");
  await page.getByRole("button", { name: "Submit review" }).click();
  await page.waitForSelector(".prw-ok");
  assert.match(await page.locator(".prw-ok").innerText(), /pending approval/);
  const post = calls.find((c) => c.path.endsWith("/submit"));
  const sent = JSON.parse(post.body);
  assert.deepEqual(Object.keys(sent).sort(), ["body", "name", "productId", "rating", "title", "website"]);
  assert.equal(sent.rating, "4"); assert.equal(sent.website, ""); assert.equal(sent.productId, "123");
}, { api: (url) => (url.pathname.endsWith("/submit") ? { body: JSON.stringify({ ok: true, status: "PENDING", uploadToken: null }) } : null) });

await run("form: rate limit message is shown on HTTP 429", async (page) => {
  await ready(page);
  await page.getByRole("button", { name: "Write a review" }).click();
  await page.locator("label[for$='-5']").click();
  await page.fill("textarea[name=body]", "Nice one"); await page.fill("input[name=name]", "Pat");
  await page.getByRole("button", { name: "Submit review" }).click();
  await page.waitForSelector(".prw-err:not([hidden])");
  assert.match(await page.locator(".prw-err:not([hidden])").first().innerText(), /Too many reviews/);
}, { api: (url) => (url.pathname.endsWith("/submit") ? { status: 429, body: "{}" } : null) });

await run("accessibility basics: honeypot hidden from users and assistive tech, labelled inputs, keyboard reachable", async (page) => {
  await ready(page);
  await page.getByRole("button", { name: "Write a review" }).click();
  assert.equal(await page.locator(".prw-hp[aria-hidden=true] input[name=website]").count(), 1);
  assert.equal(await page.locator("input[name=website]").getAttribute("tabindex"), "-1");
  for (const sel of ["textarea[name=body]", "input[name=name]", "input[name=title]"]) {
    const id = await page.locator(sel).getAttribute("id");
    assert.equal(await page.locator(`label[for="${id}"]`).count(), 1, sel);
  }
  assert.equal(await page.locator("input[name=rating]").count(), 5);
  assert.equal(await page.getByRole("button", { name: "Cancel" }).getAttribute("aria-expanded"), "true");
  await page.keyboard.press("Tab");
  assert.ok(await page.evaluate(() => document.activeElement && document.activeElement !== document.body));
  assert.equal(await page.locator("[role=img][aria-label*='out of 5 stars']").first().isVisible(), true);
});

await run("question form posts name and question and confirms", async (page, calls) => {
  await ready(page);
  await page.getByRole("button", { name: "Ask a question" }).click();
  await page.fill("input[name=name]", "Quinn"); await page.fill("textarea[name=body]", "Is it washable?");
  await page.getByRole("button", { name: "Submit review" }).click();
  await page.waitForSelector(".prw-ok");
  const sent = JSON.parse(calls.find((c) => c.path.endsWith("/question")).body);
  assert.equal(sent.body, "Is it washable?");
}, { api: (url) => (url.pathname.endsWith("/question") ? { body: JSON.stringify({ ok: true }) } : null) });

await run("widget removes itself when the plan has display turned off", async (page) => {
  await page.waitForFunction(() => document.querySelector("#prw-1").childElementCount === 0);
}, { data: { disabled: true, settings: {} } });

await run("mini star rating shows when there are reviews and stays hidden when there are none", async (page) => {
  await page.waitForSelector("[data-prw-mini]:not([hidden])");
  assert.match(await page.locator("[data-prw-mini]").innerText(), /Based on 3 reviews/);
  assert.equal(await page.locator("[data-prw-mini]").getAttribute("href"), "#prw-1");
}, { extra: `<a data-prw-mini data-product-id="123" data-endpoint="/apps/reviews" hidden></a>`, data: base() });

await run("mini star rating stays hidden with zero reviews", async (page) => {
  await page.waitForTimeout(300);
  assert.equal(await page.locator("[data-prw-mini]").isHidden(), true);
}, { extra: `<a data-prw-mini data-product-id="123" data-endpoint="/apps/reviews" hidden></a>`, data: base({ summary: { total: 0, average: null, distribution: [] }, reviews: [], hasMore: false }) });
