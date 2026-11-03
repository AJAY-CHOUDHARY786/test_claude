import { test } from "node:test";
import assert from "node:assert/strict";
import { renderText, renderHtml, ensureUnsubscribe, validateTemplate, DEFAULT_TEMPLATES } from "../app/lib/email-template.ts";

const vars = { customer_name: "Ann", product_title: "Mug", shop_name: "Shop", review_link: "https://app.example.com/r/abc", unsubscribe_link: "https://app.example.com/unsubscribe?t=x" };

test("fills placeholders and blanks unknown ones", () => {
  assert.equal(renderText("Hi {{customer_name}} {{ nope }}!", vars), "Hi Ann !");
});

test("HTML output escapes customer-controlled values", () => {
  const html = renderHtml("Hello {{customer_name}}", { ...vars, customer_name: '<script>alert(1)</script><img src=x onerror="y">' });
  assert.ok(!html.includes("<script>") && !html.includes("<img"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("HTML output turns links into anchors and keeps line breaks", () => {
  const html = renderHtml("Go: {{review_link}}\nBye", vars);
  assert.ok(html.includes('<a href="https://app.example.com/r/abc">'));
  assert.ok(html.includes("<br>"));
});

test("an unsubscribe link is always guaranteed", () => {
  assert.ok(ensureUnsubscribe("Hi {{review_link}}").includes("{{unsubscribe_link}}"));
  assert.equal(ensureUnsubscribe("x {{unsubscribe_link}}"), "x {{unsubscribe_link}}");
});

test("default templates are valid and contain review and unsubscribe links", () => {
  for (const t of Object.values(DEFAULT_TEMPLATES)) {
    assert.equal(validateTemplate(t.subject, t.body), null);
    assert.ok(t.body.includes("{{unsubscribe_link}}"));
  }
});

test("rejects templates without a review link, with unknown placeholders or bad lengths", () => {
  assert.ok(validateTemplate("Hi", "no link here"));
  assert.ok(validateTemplate("Hi", "{{review_link}} {{credit_card}}")?.includes("credit_card"));
  assert.ok(validateTemplate("", "{{review_link}}"));
  assert.ok(validateTemplate("x".repeat(151), "{{review_link}}"));
});
