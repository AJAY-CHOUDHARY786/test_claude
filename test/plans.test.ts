import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveEntitlements, hasFeature, assertFeature, FeatureDeniedError, planFromSubscriptionName,
  computeTrialEnd, PLAN_CATALOG, ADVANCED_ONLY_FEATURES, BASIC_FEATURES,
} from "../app/lib/plans.ts";

const now = new Date("2026-06-15T00:00:00Z");
const sub = (plan: "basic" | "advanced" | null, status: any = "ACTIVE", trialEndsAt: Date | null = null) => ({ plan, status, trialEndsAt });

test("catalog matches the approved pricing", () => {
  assert.equal(PLAN_CATALOG.basic.priceUsdMonthly, 9);
  assert.equal(PLAN_CATALOG.advanced.priceUsdMonthly, 15);
  assert.equal(PLAN_CATALOG.basic.trialDays, 30);
  assert.equal(PLAN_CATALOG.advanced.trialDays, 30);
});

test("Basic merchants get every basic feature and no advanced feature", () => {
  const ent = resolveEntitlements(sub("basic"), now);
  for (const f of BASIC_FEATURES) assert.ok(hasFeature(ent, f), f);
  for (const f of ADVANCED_ONLY_FEATURES) {
    assert.ok(!hasFeature(ent, f), f);
    assert.throws(() => assertFeature(ent, f), FeatureDeniedError);
  }
});

test("Advanced merchants get everything", () => {
  const ent = resolveEntitlements(sub("advanced"), now);
  for (const f of [...BASIC_FEATURES, ...ADVANCED_ONLY_FEATURES]) assert.ok(hasFeature(ent, f), f);
});

test("non-active or missing subscriptions lose paid features but keep storefront display and export", () => {
  for (const status of ["CANCELLED", "DECLINED", "EXPIRED", "FROZEN", "PENDING", null]) {
    const ent = resolveEntitlements(sub("advanced", status), now);
    assert.equal(ent.active, false);
    assert.ok(!hasFeature(ent, "reviews.manage"));
    assert.ok(!hasFeature(ent, "widgets.customize"));
    assert.ok(hasFeature(ent, "storefront.display"));
    assert.ok(hasFeature(ent, "csv.export"));
  }
  assert.equal(resolveEntitlements(null, now).active, false);
  assert.equal(resolveEntitlements(sub(null), now).active, false);
});

test("an unknown plan value from the database grants nothing", () => {
  const ent = resolveEntitlements({ plan: "enterprise" as any, status: "ACTIVE", trialEndsAt: null }, now);
  assert.equal(ent.active, false);
  assert.ok(!hasFeature(ent, "reviews.manage"));
});

test("trial state follows the trial end date", () => {
  assert.equal(resolveEntitlements(sub("basic", "ACTIVE", new Date("2026-06-20T00:00:00Z")), now).inTrial, true);
  assert.equal(resolveEntitlements(sub("basic", "ACTIVE", new Date("2026-06-10T00:00:00Z")), now).inTrial, false);
  assert.equal(resolveEntitlements(sub("basic", "ACTIVE", null), now).inTrial, false);
});

test("downgrade removes advanced access immediately", () => {
  assert.ok(hasFeature(resolveEntitlements(sub("advanced"), now), "analytics.advanced"));
  assert.ok(!hasFeature(resolveEntitlements(sub("basic"), now), "analytics.advanced"));
});

test("plan names map case-insensitively and unknown names map to null", () => {
  assert.equal(planFromSubscriptionName(" Advanced "), "advanced");
  assert.equal(planFromSubscriptionName("BASIC"), "basic");
  assert.equal(planFromSubscriptionName("Premium"), null);
});

test("trial end is creation date plus trial days", () => {
  assert.equal(computeTrialEnd(new Date("2026-01-01T00:00:00Z"), 30)?.toISOString(), "2026-01-31T00:00:00.000Z");
  assert.equal(computeTrialEnd(new Date(), 0), null);
});

import { FEATURE_LABELS } from "../app/lib/feature-labels.ts";
test("every feature has a label for the billing page", () => {
  for (const f of [...BASIC_FEATURES, ...ADVANCED_ONLY_FEATURES]) assert.ok(FEATURE_LABELS[f], f);
});
