/** Email template rendering. Variables are escaped for HTML; an unsubscribe link is always present. */
import { escapeHtml } from "./review-validation.ts";

export type TemplateVars = Record<string, string>;
export const ALLOWED_VARS = ["customer_name", "product_title", "shop_name", "review_link", "unsubscribe_link"] as const;

export const DEFAULT_TEMPLATES = {
  REQUEST: {
    subject: "How is your {{product_title}}?",
    body: "Hi {{customer_name}},\n\nThanks for your order from {{shop_name}}. Would you share a quick review of {{product_title}}? It helps other shoppers and takes about a minute.\n\n{{review_link}}\n\nThank you,\n{{shop_name}}\n\nDon't want these emails? Unsubscribe: {{unsubscribe_link}}",
  },
  REMINDER: {
    subject: "Reminder: review your {{product_title}}",
    body: "Hi {{customer_name}},\n\nJust a reminder that we would love to hear what you think of {{product_title}}.\n\n{{review_link}}\n\nThank you,\n{{shop_name}}\n\nUnsubscribe: {{unsubscribe_link}}",
  },
} as const;

export function renderText(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}

const LINK_RE = /(https?:\/\/[^\s<>"']+)/g;

export function renderHtml(template: string, vars: TemplateVars): string {
  const safe: TemplateVars = {};
  for (const [k, v] of Object.entries(vars)) safe[k] = escapeHtml(v);
  const filled = renderText(escapeHtml(template).replace(/&#39;|&quot;/g, (m) => m), safe);
  const linked = filled.replace(LINK_RE, (url) => `<a href="${url}">${url}</a>`);
  return `<div style="font-family:system-ui,sans-serif;line-height:1.5">${linked.replace(/\n/g, "<br>")}</div>`;
}

/** Guarantees an unsubscribe link even if a merchant removed it from their custom template. */
export function ensureUnsubscribe(body: string): string {
  return /\{\{\s*unsubscribe_link\s*\}\}/.test(body) ? body : `${body}\n\nUnsubscribe: {{unsubscribe_link}}`;
}

export function validateTemplate(subject: string, body: string): string | null {
  if (!subject.trim() || subject.length > 150) return "Subject must be between 1 and 150 characters";
  if (!body.trim() || body.length > 5000) return "Message must be between 1 and 5000 characters";
  if (!/\{\{\s*review_link\s*\}\}/.test(body)) return "The message must include {{review_link}} so customers can leave a review";
  const unknown = [...(subject + body).matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map((m) => m[1]!.toLowerCase()).filter((v) => !(ALLOWED_VARS as readonly string[]).includes(v));
  if (unknown.length) return `Unknown placeholder(s): ${[...new Set(unknown)].join(", ")}`;
  return null;
}
