import assert from "node:assert/strict";
import { test } from "node:test";

import type { SubscriptionRecord } from "@backend/subscriptions/contracts.js";
import type { SubscriptionsService } from "@backend/subscriptions/service";

import { createCreateSubscriptionHandler } from "../src/handlers/subscriptions/create";
import { createEmptyTrashHandler } from "../src/handlers/subscriptions/empty-trash";
import { createListSubscriptionsHandler } from "../src/handlers/subscriptions/list";
import { createListTrashedSubscriptionsHandler } from "../src/handlers/subscriptions/list-trash";
import { createPermanentDeleteSubscriptionHandler } from "../src/handlers/subscriptions/permanent-delete";
import { createRestoreSubscriptionHandler } from "../src/handlers/subscriptions/restore";
import { createTrashSubscriptionHandler } from "../src/handlers/subscriptions/trash";
import { createUpdateSubscriptionHandler } from "../src/handlers/subscriptions/update";
import type { AuthenticatedContext } from "../src/http/types";

const AUTH_USER_ID = "auth-user-123";

const sampleSubscription = (): SubscriptionRecord => ({
  id: "sub-1",
  userId: AUTH_USER_ID,
  serviceName: "Netflix",
  category: "streaming",
  price: 15.99,
  currency: "USD",
  billingCycle: "monthly",
  billingCycleCustomDays: null,
  nextBillingDate: new Date("2026-07-01T00:00:00.000Z"),
  notes: null,
  trialEndDate: null,
  status: "active",
  reminderDaysBefore: [7, 3],
  nextReminderAt: new Date("2026-06-24T00:00:00.000Z"),
  lastNotifiedBillingDate: null,
  nextTrialReminderAt: null,
  lastNotifiedTrialEndDate: null,
  active: true,
  deletedAt: null,
  createdAt: new Date("2026-06-26T00:00:00.000Z"),
  updatedAt: new Date("2026-06-26T00:00:00.000Z"),
});

const minimalCreateBody = () => ({
  serviceName: "Netflix",
  category: "streaming",
  price: 15.99,
  currency: "USD",
  billingCycle: "monthly" as const,
  nextBillingDate: 1_700_000_000_000,
  status: "active" as const,
  reminderDaysBefore: [] as ReadonlyArray<number>,
});

const createAuthContext = (
  input: Readonly<{
    body?: unknown;
    params?: Readonly<Record<string, string>>;
  }> = {},
): AuthenticatedContext => ({
  request: {} as AuthenticatedContext["request"],
  method: "GET",
  url: new URL("http://localhost/api/subscriptions"),
  headers: new Headers(),
  body: input.body ?? null,
  params: input.params ?? {},
  query: {},
  cookies: {},
  clientIp: null,
  forwardedProto: null,
  authUser: { userId: AUTH_USER_ID, username: "alice" },
});

const createSubscriptionsServiceDouble = () => {
  const calls: Array<Readonly<{ method: string; args: Record<string, unknown> }>> = [];

  const subscriptionsService: SubscriptionsService = {
    list: async (input) => {
      calls.push({ method: "list", args: input as Record<string, unknown> });
      return [sampleSubscription()];
    },
    listTrashed: async (input) => {
      calls.push({ method: "listTrashed", args: input as Record<string, unknown> });
      return [{ ...sampleSubscription(), deletedAt: new Date("2026-06-25T00:00:00.000Z") }];
    },
    create: async (input) => {
      calls.push({ method: "create", args: input as Record<string, unknown> });
      return sampleSubscription();
    },
    update: async (input) => {
      calls.push({ method: "update", args: input as Record<string, unknown> });
      return { ...sampleSubscription(), price: 19.99 };
    },
    trash: async (input) => {
      calls.push({ method: "trash", args: input as Record<string, unknown> });
      return true;
    },
    restore: async (input) => {
      calls.push({ method: "restore", args: input as Record<string, unknown> });
      return true;
    },
    permanentlyDelete: async (input) => {
      calls.push({ method: "permanentlyDelete", args: input as Record<string, unknown> });
      return true;
    },
    emptyTrash: async (input) => {
      calls.push({ method: "emptyTrash", args: input as Record<string, unknown> });
      return 2;
    },
    purgeExpiredTrash: async (input) => {
      calls.push({ method: "purgeExpiredTrash", args: input as Record<string, unknown> });
      return 0;
    },
  };

  return { subscriptionsService, calls };
};

test("createListSubscriptionsHandler delegates to subscriptionsService.list with auth userId", async () => {
  const { subscriptionsService, calls } = createSubscriptionsServiceDouble();
  const handler = createListSubscriptionsHandler(subscriptionsService);

  const result = await handler(createAuthContext());

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "list");
  assert.equal(calls[0]?.args.userId, AUTH_USER_ID);
  assert.deepStrictEqual(result, { subscriptions: [sampleSubscription()] });
});

test("createListTrashedSubscriptionsHandler delegates to subscriptionsService.listTrashed", async () => {
  const { subscriptionsService, calls } = createSubscriptionsServiceDouble();
  const handler = createListTrashedSubscriptionsHandler(subscriptionsService);

  const result = await handler(createAuthContext());

  assert.equal(calls[0]?.method, "listTrashed");
  assert.equal(calls[0]?.args.userId, AUTH_USER_ID);
  assert.equal(result.subscriptions.length, 1);
  assert.ok(result.subscriptions[0]?.deletedAt instanceof Date);
});

test("createCreateSubscriptionHandler converts epoch dates before service.create", async () => {
  const { subscriptionsService, calls } = createSubscriptionsServiceDouble();
  const handler = createCreateSubscriptionHandler(subscriptionsService);

  const trialEndEpoch = 1_800_000_000_000;
  const result = await handler(
    createAuthContext({
      body: {
        ...minimalCreateBody(),
        notes: "family plan",
        trialEndDate: trialEndEpoch,
        billingCycleCustomDays: 30,
      },
    }),
  );

  assert.equal(calls[0]?.method, "create");
  assert.equal(calls[0]?.args.userId, AUTH_USER_ID);
  assert.equal(calls[0]?.args.serviceName, "Netflix");
  assert.equal(calls[0]?.args.notes, "family plan");
  assert.equal(calls[0]?.args.billingCycleCustomDays, 30);

  const nextBillingDate = calls[0]?.args.nextBillingDate as Date;
  assert.ok(nextBillingDate instanceof Date);
  assert.equal(nextBillingDate.getTime(), 1_700_000_000_000);

  const trialEndDate = calls[0]?.args.trialEndDate as Date;
  assert.ok(trialEndDate instanceof Date);
  assert.equal(trialEndDate.getTime(), trialEndEpoch);

  assert.deepStrictEqual(result, { subscription: sampleSubscription() });
});

test("createCreateSubscriptionHandler passes null trialEndDate when omitted", async () => {
  const { subscriptionsService, calls } = createSubscriptionsServiceDouble();
  const handler = createCreateSubscriptionHandler(subscriptionsService);

  await handler(createAuthContext({ body: minimalCreateBody() }));

  assert.equal(calls[0]?.args.trialEndDate, null);
});

test("createUpdateSubscriptionHandler builds patch with date coercion", async () => {
  const { subscriptionsService, calls } = createSubscriptionsServiceDouble();
  const handler = createUpdateSubscriptionHandler(subscriptionsService);

  const nextBillingEpoch = 1_900_000_000_000;
  const result = await handler(
    createAuthContext({
      params: { subscriptionId: "sub-update-1" },
      body: {
        price: 19.99,
        nextBillingDate: nextBillingEpoch,
        trialEndDate: null,
      },
    }),
  );

  assert.equal(calls[0]?.method, "update");
  assert.deepStrictEqual(calls[0]?.args, {
    subscriptionId: "sub-update-1",
    userId: AUTH_USER_ID,
    patch: {
      price: 19.99,
      nextBillingDate: new Date(nextBillingEpoch),
      trialEndDate: null,
    },
  });
  assert.equal(result.subscription.price, 19.99);
});

test("createEmptyTrashHandler returns deleted count from service", async () => {
  const { subscriptionsService, calls } = createSubscriptionsServiceDouble();
  const handler = createEmptyTrashHandler(subscriptionsService);

  const result = await handler(createAuthContext());

  assert.equal(calls[0]?.method, "emptyTrash");
  assert.equal(calls[0]?.args.userId, AUTH_USER_ID);
  assert.deepStrictEqual(result, { deleted: 2 });
});

test("createTrashSubscriptionHandler delegates subscriptionId from params", async () => {
  const { subscriptionsService, calls } = createSubscriptionsServiceDouble();
  const handler = createTrashSubscriptionHandler(subscriptionsService);

  const result = await handler(
    createAuthContext({
      params: { subscriptionId: "sub-trash-1" },
    }),
  );

  assert.equal(calls[0]?.method, "trash");
  assert.deepStrictEqual(calls[0]?.args, {
    userId: AUTH_USER_ID,
    subscriptionId: "sub-trash-1",
  });
  assert.deepStrictEqual(result, { deleted: true });
});

test("createRestoreSubscriptionHandler delegates subscriptionId from params", async () => {
  const { subscriptionsService, calls } = createSubscriptionsServiceDouble();
  const handler = createRestoreSubscriptionHandler(subscriptionsService);

  const result = await handler(
    createAuthContext({
      params: { subscriptionId: "sub-restore-1" },
    }),
  );

  assert.equal(calls[0]?.method, "restore");
  assert.deepStrictEqual(calls[0]?.args, {
    userId: AUTH_USER_ID,
    subscriptionId: "sub-restore-1",
  });
  assert.deepStrictEqual(result, { restored: true });
});

test("createPermanentDeleteSubscriptionHandler delegates subscriptionId from params", async () => {
  const { subscriptionsService, calls } = createSubscriptionsServiceDouble();
  const handler = createPermanentDeleteSubscriptionHandler(subscriptionsService);

  const result = await handler(
    createAuthContext({
      params: { subscriptionId: "sub-permanent-1" },
    }),
  );

  assert.equal(calls[0]?.method, "permanentlyDelete");
  assert.deepStrictEqual(calls[0]?.args, {
    userId: AUTH_USER_ID,
    subscriptionId: "sub-permanent-1",
  });
  assert.deepStrictEqual(result, { deleted: true });
});