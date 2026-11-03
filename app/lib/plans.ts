/**
 * Plans and server-side feature entitlements. The single source of truth for what each plan includes.
 * The UI only reflects these answers. Every route, API and job must call assertFeature().
 */
export type PlanId = "basic" | "advanced";
export type SubscriptionStatus = "ACTIVE" | "CANCELLED" | "DECLINED" | "EXPIRED" | "FROZEN" | "PENDING";

export const BASIC_FEATURES = [
  "reviews.manage", "reviews.moderate", "reviews.reply", "storefront.display", "storefront.collect",
  "widgets.standard", "requests.basic", "csv.import", "csv.export", "analytics.basic", "media.photos", "qa.manage",
] as const;
export const ADVANCED_ONLY_FEATURES = [
  "widgets.customize", "analytics.advanced", "requests.advanced", "display.advanced", "moderation.bulk",
] as const;
/** Kept when there is no active subscription so a lapse never blanks the storefront or locks merchants out of their data. */
export const INACTIVE_FEATURES = ["storefront.display", "csv.export"] as const;

export type Feature =
  | (typeof BASIC_FEATURES)[number]
  | (typeof ADVANCED_ONLY_FEATURES)[number]
  | (typeof INACTIVE_FEATURES)[number];

export interface PlanDefinition {
  id: PlanId; name: string; priceUsdMonthly: number; trialDays: number; features: readonly Feature[];
}

export const PLAN_CATALOG: Record<PlanId, PlanDefinition> = {
  basic: { id: "basic", name: "Basic", priceUsdMonthly: 9, trialDays: 30, features: [...BASIC_FEATURES] },
  advanced: { id: "advanced", name: "Advanced", priceUsdMonthly: 15, trialDays: 30, features: [...BASIC_FEATURES, ...ADVANCED_ONLY_FEATURES] },
};

export interface SubscriptionState {
  plan: PlanId | null;
  status: SubscriptionStatus | null;
  trialEndsAt: Date | null;
}

export interface Entitlements {
  active: boolean;
  plan: PlanId | null;
  inTrial: boolean;
  features: ReadonlySet<Feature>;
}

export function resolveEntitlements(sub: SubscriptionState | null, now: Date): Entitlements {
  if (!sub || !sub.plan || sub.status !== "ACTIVE") {
    return { active: false, plan: null, inTrial: false, features: new Set<Feature>(INACTIVE_FEATURES) };
  }
  const def = PLAN_CATALOG[sub.plan];
  if (!def) return { active: false, plan: null, inTrial: false, features: new Set<Feature>(INACTIVE_FEATURES) };
  const inTrial = sub.trialEndsAt !== null && sub.trialEndsAt.getTime() > now.getTime();
  return { active: true, plan: sub.plan, inTrial, features: new Set<Feature>(def.features) };
}

export function hasFeature(ent: Entitlements, feature: Feature): boolean {
  return ent.features.has(feature);
}

export class FeatureDeniedError extends Error {
  readonly feature: Feature;
  constructor(feature: Feature) {
    super(`Feature not available on the current plan: ${feature}`);
    this.name = "FeatureDeniedError";
    this.feature = feature;
  }
}

export function assertFeature(ent: Entitlements, feature: Feature): void {
  if (!hasFeature(ent, feature)) throw new FeatureDeniedError(feature);
}

/** Maps the Shopify subscription name (set in the Partner Dashboard) to a plan. Unknown names return null. */
export function planFromSubscriptionName(name: string): PlanId | null {
  const n = name.trim().toLowerCase();
  if (n === "advanced") return "advanced";
  if (n === "basic") return "basic";
  return null;
}

/** Trial end = approval date + trial days. Shopify's own 180-day trial memory may shorten this for reinstalls. */
export function computeTrialEnd(createdAt: Date, trialDays: number): Date | null {
  if (!Number.isFinite(trialDays) || trialDays <= 0) return null;
  return new Date(createdAt.getTime() + trialDays * 86_400_000);
}
