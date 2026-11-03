/** Server-side validation and plan gating for settings forms. Fields the plan does not include are never written. */
export interface FormLike { get(key: string): unknown }

export const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const on = (f: FormLike, k: string) => f.get(k) === "on";
const text = (f: FormLike, k: string) => String(f.get(k) ?? "");

export function buildGeneralUpdate(f: FormLike) {
  return { autoPublish: on(f, "autoPublish"), reviewsPerPage: clampInt(f.get("reviewsPerPage"), 5, 50, 10), allowPhotos: on(f, "allowPhotos"), showVerifiedBadge: on(f, "showVerifiedBadge"), emitStructuredData: on(f, "emitStructuredData") };
}

export const parseExcludedProducts = (s: string): string[] => s.split(",").map((x) => x.trim()).filter((x) => /^\d{1,20}$/.test(x)).slice(0, 200);

export function buildRequestsUpdate(f: FormLike, advanced: boolean): Record<string, unknown> {
  const update: Record<string, unknown> = {
    requestsEnabled: on(f, "requestsEnabled"),
    requestDelayDays: advanced ? clampInt(f.get("requestDelayDays"), 0, 90, 7) : clampInt(f.get("requestDelayDays"), 1, 30, 7),
  };
  if (!advanced) return update; // Basic merchants cannot change anything else, whatever the form sent
  update.maxProductsPerOrder = clampInt(f.get("maxProductsPerOrder"), 1, 10, 3);
  update.reminderEnabled = on(f, "reminderEnabled");
  update.reminderDelayDays = clampInt(f.get("reminderDelayDays"), 3, 30, 7);
  update.excludedProductIds = parseExcludedProducts(text(f, "excludedProductIds"));
  update.senderName = text(f, "senderName").replace(/[<>"\r\n]/g, "").trim().slice(0, 60) || null;
  const reply = text(f, "replyToEmail").trim();
  update.replyToEmail = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(reply) && reply.length <= 254 ? reply : null;
  return update;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
export function validateWidgetUpdate(f: FormLike): { ok: true; value: { widgetAccentColor: string; widgetLayout: string } } | { ok: false; error: string } {
  const color = text(f, "widgetAccentColor"), layout = text(f, "widgetLayout") || "list";
  if (!HEX.test(color) || !["list", "grid"].includes(layout)) return { ok: false, error: "Enter a color like #1f4b3f and choose a layout." };
  return { ok: true, value: { widgetAccentColor: color, widgetLayout: layout } };
}

export function validateProductOverride(f: FormLike): { ok: true; value: { hidden: boolean; layout: string | null; accentColor: string | null } } | { ok: false; error: string } {
  const accent = text(f, "accentColor").trim(), layout = text(f, "layout");
  if ((accent && !HEX.test(accent)) || (layout && !["list", "grid"].includes(layout))) return { ok: false, error: "Use a color like #1f4b3f and a list or grid layout." };
  return { ok: true, value: { hidden: on(f, "hidden"), layout: layout || null, accentColor: accent || null } };
}
