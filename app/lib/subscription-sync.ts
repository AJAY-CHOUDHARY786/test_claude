/** Turns Shopify's active subscriptions into the one local subscription record. */
import { computeTrialEnd, planFromSubscriptionName, type PlanId } from "./plans.ts";

export interface ShopifySubscription { id: string; name: string; status: string; trialDays: number; createdAt: string; currentPeriodEnd: string | null; test: boolean }
export interface SubscriptionData { shopifySubscriptionId: string | null; plan: PlanId | null; status: string; trialEndsAt: Date | null; currentPeriodEnd: Date | null; isTest: boolean }

const validDate = (s: string | null | undefined): Date | null => { if (!s) return null; const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d; };

export function pickSubscription(subs: ShopifySubscription[]): { data: SubscriptionData; unrecognised: boolean } {
  const active = subs.filter((s) => String(s.status).toUpperCase() === "ACTIVE");
  const recognised = active.map((s) => ({ s, plan: planFromSubscriptionName(s.name) })).filter((x): x is { s: ShopifySubscription; plan: PlanId } => x.plan !== null);
  // If Shopify ever reports two plans at once, the more expensive one wins.
  const pick = recognised.find((x) => x.plan === "advanced") ?? recognised[0];
  if (!pick) {
    return { data: { shopifySubscriptionId: null, plan: null, status: "NONE", trialEndsAt: null, currentPeriodEnd: null, isTest: false }, unrecognised: active.length > 0 };
  }
  const created = validDate(pick.s.createdAt);
  return {
    unrecognised: false,
    data: {
      shopifySubscriptionId: pick.s.id, plan: pick.plan, status: "ACTIVE",
      trialEndsAt: created ? computeTrialEnd(created, Number(pick.s.trialDays)) : null,
      currentPeriodEnd: validDate(pick.s.currentPeriodEnd), isTest: Boolean(pick.s.test),
    },
  };
}
