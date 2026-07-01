import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { after, afterEach, before, test } from "node:test";

import { createTokenFactory } from "@backend/auth/tokens";
import type { SubscriptionRecord } from "@backend/subscriptions/contracts.js";
import type { SubscriptionsService } from "@backend/subscriptions/service";

import { POST as createSubscriptionPost } from "../app/api/subscriptions/route";
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

const AUTH_USER_ID = "subscriptions-create-route-user-1";
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = 1_700_000_000_000;

const subscriptionsCreateRouteRegistrations: ReadonlyArray<RouteRegistration> = [
  { method: "POST", pathname: "/api/subscriptions", handler: createSubscriptionPost },
];

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  return (await response.json()) as Record<string, unknown>;
};

const minimalCreateBody = () => ({
  serviceName: "Netflix",
  category: "streaming",
  price: 15.99,
  currency: "USD",
  billingCycle: "monthly",
  nextBillingDate: NOW_MS + 10 * DAY_MS,
  status: "active",
  reminderDaysBefore: [2, 5],
  trialEndDate: NOW_MS + 4 * DAY_MS,
});

const computeNextReminderAt = (
  nextBillingDate: Date,
  reminderDaysBefore: ReadonlyArray<number>,
): Date | null => {
  const candidates = reminderDaysBefore
    .map((days) => nextBillingDate.getTime() - days * DAY_MS)
    .filter((candidate) => candidate > NOW_MS)
    .sort((a, b) => a - b);

  return candidates.length > 0 ? new Date(candidates[0]) : null;
};

const computeNextTrialReminderAt = (
  trialEndDate: Date | null,
  reminderDaysBefore: ReadonlyArray<number>,
): Date | null => {
  if (!trialEndDate) {
    return null;
  }

  return computeNextReminderAt(trialEndDate, reminderDaysBefore);
};

const createSubscriptionsServiceDouble = (): SubscriptionsService => ({
  list: async () => {
    throw new Error("not implemented in create route test double");
  },
  listTrashed: async () => {
    throw new Error("not implemented in create route test double");
  },
  create: async (input) => {
    assert.equal(input.userId, AUTH_USER_ID);

    const now = new Date(NOW_MS);
    const record: SubscriptionRecord = {
      id: "sub-created-1",
      userId: input.userId,
      serviceName: input.serviceName,
      category: input.category,
      price: input.price,
      currency: input.currency,
      billingCycle: input.billingCycle,
      billingCycleCustomDays: input.billingCycleCustomDays,
      nextBillingDate: input.nextBillingDate,
      notes: input.notes,
      trialEndDate: input.trialEndDate,
      status: input.status,
      reminderDaysBefore: [...input.reminderDaysBefore],
      nextReminderAt: computeNextReminderAt(input.nextBillingDate, input.reminderDaysBefore),
      lastNotifiedBillingDate: null,
      nextTrialReminderAt: computeNextTrialReminderAt(
        input.trialEndDate,
        input.reminderDaysBefore,
      ),
      lastNotifiedTrialEndDate: null,
      active: true,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    return record;
  },
  update: async () => {
    throw new Error("not implemented in create route test double");
  },
  trash: async () => {
    throw new Error("not implemented in create route test double");
  },
  restore: async () => {
    throw new Error("not implemented in create route test double");
  },
  permanentlyDelete: async () => {
    throw new Error("not implemented in create route test double");
  },
  emptyTrash: async () => {
    throw new Error("not implemented in create route test double");
  },
  purgeExpiredTrash: async () => {
    throw new Error("not implemented in create route test double");
  },
});

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
let accessToken: string;

before(async () => {
  const services = composeServices();
  setComposedServicesForTests({
    ...services,
    subscriptionsService: createSubscriptionsServiceDouble(),
  });

  const tokenFactory = createTokenFactory();
  const tokens = await tokenFactory.issueTokenPair({
    userId: AUTH_USER_ID,
    username: "alice",
  });
  accessToken = tokens.accessToken;

  server = await startNextTestServer({ routes: subscriptionsCreateRouteRegistrations });
});

after(async () => {
  await server.close();
  resetComposedServicesForTests();
});

afterEach(() => {
  resetPoolErrorStateForTests();
});

test("POST /api/subscriptions returns 401 without auth or guest headers", async () => {
  const response = await server.fetch("/api/subscriptions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(minimalCreateBody()),
  });
  const payload = await readJson(response);

  assert.equal(response.status, 401);
  assert.equal(payload.code, "auth");
  assert.equal(payload.status, 401);
});

test("POST /api/subscriptions returns 201 with subscription payload for bearer-authenticated user", async () => {
  const response = await server.fetch("/api/subscriptions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(minimalCreateBody()),
  });
  const payload = await readJson(response);

  assert.equal(response.status, 201);
  const subscription = payload.subscription as Record<string, unknown>;
  assert.equal(subscription.id, "sub-created-1");
  assert.equal(subscription.serviceName, "Netflix");
  assert.equal(subscription.userId, AUTH_USER_ID);
});

test("POST /api/subscriptions returns reminder fields derived by service", async () => {
  const response = await server.fetch("/api/subscriptions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(minimalCreateBody()),
  });
  const payload = await readJson(response);

  assert.equal(response.status, 201);
  const subscription = payload.subscription as Record<string, unknown>;
  assert.ok(subscription.nextReminderAt);
  assert.ok(subscription.nextTrialReminderAt);
});

test("POST /api/subscriptions returns 400 validation on invalid billing cycle", async () => {
  const response = await server.fetch("/api/subscriptions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...minimalCreateBody(),
      billingCycle: "daily",
    }),
  });
  const payload = await readJson(response);

  assert.equal(response.status, 400);
  assert.equal(payload.code, "validation");
});

test("POST /api/subscriptions returns 400 validation on missing required fields", async () => {
  const response = await server.fetch("/api/subscriptions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ serviceName: "Netflix" }),
  });
  const payload = await readJson(response);

  assert.equal(response.status, 400);
  assert.equal(payload.code, "validation");
});

test("POST /api/subscriptions returns 500 internal when dependencies are degraded", async () => {
  const mockPool = createMockPool();
  attachSoftPoolErrorHandling(mockPool);
  mockPool.emit(new Error("idle client connection lost"));

  const response = await server.fetch("/api/subscriptions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(minimalCreateBody()),
  });
  const payload = await readJson(response);

  assert.equal(response.status, 500);
  assert.deepStrictEqual(payload, {
    code: "internal",
    message: "Internal server error",
    status: 500,
  });
});