import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { after, afterEach, before, test } from "node:test";

import { createTokenFactory } from "@backend/auth/tokens";
import { AppError } from "@backend/middleware/error-middleware";
import type { SubscriptionRecord } from "@backend/subscriptions/contracts.js";
import type { SubscriptionsService } from "@backend/subscriptions/service";

import { PATCH as updateSubscriptionPatch } from "../app/api/subscriptions/[subscriptionId]/route";
import {
  attachSoftPoolErrorHandling,
  resetPoolErrorStateForTests,
  type PoolErrorEventTarget,
} from "../src/db/pool";
import {
  composeServices,
  resetComposedServicesForTests,
  setComposedServicesForTests,
} from "../src/server/compose-services-impl";
import {
  startNextTestServer,
  type NextTestServer,
  type RouteRegistration,
} from "./support/next-test-server";

const OWNER_USER_ID = "subscriptions-update-route-owner";
const OTHER_USER_ID = "subscriptions-update-route-other";
const SUBSCRIPTION_ID = "sub-owned-1";
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = 1_700_000_000_000;

const subscriptionsUpdateRouteRegistrations: ReadonlyArray<RouteRegistration> = [
  {
    method: "PATCH",
    pathname: "/api/subscriptions/:subscriptionId",
    pattern: "/api/subscriptions/:subscriptionId",
    handler: updateSubscriptionPatch,
  },
];

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  return (await response.json()) as Record<string, unknown>;
};

const sampleOwnedSubscription = (): SubscriptionRecord => ({
  id: SUBSCRIPTION_ID,
  userId: OWNER_USER_ID,
  serviceName: "Netflix",
  category: "streaming",
  price: 15.99,
  currency: "USD",
  billingCycle: "monthly",
  billingCycleCustomDays: null,
  nextBillingDate: new Date(NOW_MS + 10 * DAY_MS),
  notes: null,
  trialEndDate: null,
  status: "active",
  reminderDaysBefore: [7, 3],
  nextReminderAt: new Date(NOW_MS + 3 * DAY_MS),
  lastNotifiedBillingDate: null,
  nextTrialReminderAt: null,
  lastNotifiedTrialEndDate: null,
  active: true,
  deletedAt: null,
  createdAt: new Date(NOW_MS),
  updatedAt: new Date(NOW_MS),
});

const createSubscriptionsServiceDouble = (): SubscriptionsService => {
  const byUser = new Map<string, Map<string, SubscriptionRecord>>();
  byUser.set(OWNER_USER_ID, new Map([[SUBSCRIPTION_ID, sampleOwnedSubscription()]]));

  const getUserMap = (userId: string): Map<string, SubscriptionRecord> => {
    const existing = byUser.get(userId);
    if (existing) {
      return existing;
    }

    const created = new Map<string, SubscriptionRecord>();
    byUser.set(userId, created);
    return created;
  };

  return {
    list: async () => {
      throw new Error("not implemented in update route test double");
    },
    listTrashed: async () => {
      throw new Error("not implemented in update route test double");
    },
    create: async () => {
      throw new Error("not implemented in update route test double");
    },
    update: async ({ subscriptionId, userId, patch }) => {
      const existing = getUserMap(userId).get(subscriptionId);
      if (!existing) {
        throw new AppError({
          code: "not_found",
          message: "Subscription not found",
        });
      }

      const updated: SubscriptionRecord = {
        ...existing,
        ...patch,
        nextBillingDate: patch.nextBillingDate ?? existing.nextBillingDate,
        trialEndDate: Object.hasOwn(patch, "trialEndDate")
          ? (patch.trialEndDate ?? null)
          : existing.trialEndDate,
        reminderDaysBefore: patch.reminderDaysBefore ?? existing.reminderDaysBefore,
        updatedAt: new Date(NOW_MS + DAY_MS),
      };

      getUserMap(userId).set(subscriptionId, updated);
      return updated;
    },
    trash: async () => {
      throw new Error("not implemented in update route test double");
    },
    restore: async () => {
      throw new Error("not implemented in update route test double");
    },
    permanentlyDelete: async () => {
      throw new Error("not implemented in update route test double");
    },
    emptyTrash: async () => {
      throw new Error("not implemented in update route test double");
    },
    purgeExpiredTrash: async () => {
      throw new Error("not implemented in update route test double");
    },
  };
};

const createMockPool = (): PoolErrorEventTarget & Readonly<{ emit: (error: Error) => void }> => {
  const emitter = new EventEmitter();

  return {
    removeAllListeners: (event?: string | symbol) => emitter.removeAllListeners(event),
    on: (event: "error", listener: (error: Error) => void) => emitter.on(event, listener),
    emit: (error: Error) => {
      emitter.emit("error", error);
    },
  };
};

let server: NextTestServer;
let ownerAccessToken: string;
let otherAccessToken: string;

before(async () => {
  const services = composeServices();
  setComposedServicesForTests({
    ...services,
    subscriptionsService: createSubscriptionsServiceDouble(),
  });

  const tokenFactory = createTokenFactory();
  const ownerTokens = await tokenFactory.issueTokenPair({
    userId: OWNER_USER_ID,
    username: "owner",
  });
  ownerAccessToken = ownerTokens.accessToken;

  const otherTokens = await tokenFactory.issueTokenPair({
    userId: OTHER_USER_ID,
    username: "other",
  });
  otherAccessToken = otherTokens.accessToken;

  server = await startNextTestServer({ routes: subscriptionsUpdateRouteRegistrations });
});

after(async () => {
  await server.close();
  resetComposedServicesForTests();
});

afterEach(() => {
  resetPoolErrorStateForTests();

  const services = composeServices();
  setComposedServicesForTests({
    ...services,
    subscriptionsService: createSubscriptionsServiceDouble(),
  });
});

test("PATCH /api/subscriptions/:subscriptionId returns 401 without auth or guest headers", async () => {
  const response = await server.fetch(`/api/subscriptions/${SUBSCRIPTION_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ price: 19.99 }),
  });
  const payload = await readJson(response);

  assert.equal(response.status, 401);
  assert.equal(payload.code, "auth");
  assert.equal(payload.status, 401);
});

test("PATCH /api/subscriptions/:subscriptionId returns 200 with updated subscription for owner", async () => {
  const response = await server.fetch(`/api/subscriptions/${SUBSCRIPTION_ID}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${ownerAccessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ price: 19.99 }),
  });
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  const subscription = payload.subscription as Record<string, unknown>;
  assert.equal(subscription.id, SUBSCRIPTION_ID);
  assert.equal(subscription.price, 19.99);
  assert.equal(subscription.userId, OWNER_USER_ID);
});

test("PATCH /api/subscriptions/:subscriptionId supports partial patch fields", async () => {
  const response = await server.fetch(`/api/subscriptions/${SUBSCRIPTION_ID}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${ownerAccessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ serviceName: "Netflix Premium" }),
  });
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  const subscription = payload.subscription as Record<string, unknown>;
  assert.equal(subscription.serviceName, "Netflix Premium");
  assert.equal(subscription.price, 15.99);
});

test("PATCH /api/subscriptions/:subscriptionId returns 404 not_found for cross-user update", async () => {
  const response = await server.fetch(`/api/subscriptions/${SUBSCRIPTION_ID}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${otherAccessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ price: 99 }),
  });
  const payload = await readJson(response);

  assert.equal(response.status, 404);
  assert.deepEqual(Object.keys(payload).sort(), ["code", "message", "status"]);
  assert.equal(payload.code, "not_found");
  assert.equal(payload.status, 404);
});

test("PATCH /api/subscriptions/:subscriptionId returns 400 validation on invalid body", async () => {
  const response = await server.fetch(`/api/subscriptions/${SUBSCRIPTION_ID}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${ownerAccessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ billingCycle: "daily" }),
  });
  const payload = await readJson(response);

  assert.equal(response.status, 400);
  assert.equal(payload.code, "validation");
});

test("PATCH /api/subscriptions/:subscriptionId returns 500 internal when dependencies are degraded", async () => {
  const mockPool = createMockPool();
  attachSoftPoolErrorHandling(mockPool);
  mockPool.emit(new Error("idle client connection lost"));

  const response = await server.fetch(`/api/subscriptions/${SUBSCRIPTION_ID}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${ownerAccessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ price: 21.99 }),
  });
  const payload = await readJson(response);

  assert.equal(response.status, 500);
  assert.deepStrictEqual(payload, {
    code: "internal",
    message: "Internal server error",
    status: 500,
  });
});