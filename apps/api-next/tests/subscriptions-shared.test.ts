import assert from "node:assert/strict";
import { test } from "node:test";

import {
  billingCycleSchema,
  buildUpdatePatch,
  createSubscriptionSchema,
  statusSchema,
  subscriptionIdParamsSchema,
  toDateOrNull,
  updateSubscriptionSchema,
} from "../src/handlers/subscriptions/shared";

const minimalCreateBody = () => ({
  serviceName: "Netflix",
  category: "streaming",
  price: 15.99,
  currency: "USD",
  billingCycle: "monthly" as const,
  nextBillingDate: 1_700_000_000_000,
  status: "active" as const,
});

test("billingCycleSchema accepts Express billing cycles", () => {
  for (const cycle of ["weekly", "monthly", "yearly", "custom"] as const) {
    assert.equal(billingCycleSchema.safeParse(cycle).success, true);
  }
  assert.equal(billingCycleSchema.safeParse("daily").success, false);
});

test("statusSchema accepts Express subscription statuses", () => {
  for (const status of ["active", "paused", "canceled"] as const) {
    assert.equal(statusSchema.safeParse(status).success, true);
  }
  assert.equal(statusSchema.safeParse("expired").success, false);
});

test("subscriptionIdParamsSchema requires non-empty subscriptionId", () => {
  assert.equal(subscriptionIdParamsSchema.safeParse({ subscriptionId: "sub-1" }).success, true);
  assert.equal(subscriptionIdParamsSchema.safeParse({ subscriptionId: "" }).success, false);
  assert.equal(subscriptionIdParamsSchema.safeParse({}).success, false);
});

test("createSubscriptionSchema defaults reminderDaysBefore to empty array", () => {
  const parsed = createSubscriptionSchema.parse(minimalCreateBody());

  assert.deepEqual(parsed.reminderDaysBefore, []);
});

test("createSubscriptionSchema preserves explicit reminderDaysBefore", () => {
  const parsed = createSubscriptionSchema.parse({
    ...minimalCreateBody(),
    reminderDaysBefore: [7, 3, 1],
  });

  assert.deepEqual(parsed.reminderDaysBefore, [7, 3, 1]);
});

test("createSubscriptionSchema rejects missing required fields", () => {
  assert.equal(createSubscriptionSchema.safeParse({}).success, false);
  assert.equal(
    createSubscriptionSchema.safeParse({ ...minimalCreateBody(), serviceName: "" }).success,
    false,
  );
});

test("updateSubscriptionSchema accepts partial patches", () => {
  const parsed = updateSubscriptionSchema.safeParse({ price: 19.99 });

  assert.equal(parsed.success, true);
});

test("toDateOrNull returns null for null and undefined", () => {
  assert.equal(toDateOrNull(null), null);
  assert.equal(toDateOrNull(undefined), null);
});

test("toDateOrNull converts epoch milliseconds to Date", () => {
  const epochMs = 1_700_000_000_000;
  const date = toDateOrNull(epochMs);

  assert.ok(date instanceof Date);
  assert.equal(date?.getTime(), epochMs);
});

test("buildUpdatePatch converts nextBillingDate epoch to Date", () => {
  const epochMs = 1_700_000_000_000;
  const patch = buildUpdatePatch({ nextBillingDate: epochMs });

  assert.ok(patch.nextBillingDate instanceof Date);
  assert.equal(patch.nextBillingDate?.getTime(), epochMs);
});

test("buildUpdatePatch leaves nextBillingDate undefined when not provided", () => {
  const patch = buildUpdatePatch({ price: 12.5 });

  assert.equal(patch.nextBillingDate, undefined);
});

test("buildUpdatePatch uses Object.hasOwn on body for trialEndDate semantics", () => {
  const withoutField = buildUpdatePatch({ serviceName: "Spotify" });

  assert.equal(Object.hasOwn(withoutField, "trialEndDate"), true);
  assert.equal(withoutField.trialEndDate, undefined);

  const withNull = buildUpdatePatch({ trialEndDate: null });

  assert.equal(withNull.trialEndDate, null);
});

test("buildUpdatePatch clears trialEndDate when explicitly null", () => {
  const body = { trialEndDate: null } as const;
  const patch = buildUpdatePatch(body);

  assert.equal("trialEndDate" in patch, true);
  assert.equal(patch.trialEndDate, null);
});

test("buildUpdatePatch converts trialEndDate epoch to Date", () => {
  const epochMs = 1_800_000_000_000;
  const patch = buildUpdatePatch({ trialEndDate: epochMs });

  assert.ok(patch.trialEndDate instanceof Date);
  assert.equal(patch.trialEndDate?.getTime(), epochMs);
});