import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { after, afterEach, before, test } from "node:test";

import { createTokenFactory } from "@backend/auth/tokens";
import type { SubscriptionRecord } from "@backend/subscriptions/contracts.js";
import type { SubscriptionsService } from "@backend/subscriptions/service";

import { GET as listSubscriptionsGet } from "../app/api/subscriptions/route";
import { GET as listTrashedSubscriptionsGet } from "../app/api/subscriptions/trash/route";
import {
  attachSoftPoolErrorHandling,
  resetPoolErrorStateForTests,
  type PoolErrorEventTarget,
} from "../src/db/pool";
import {
  composeServices,
  resetComposedServicesForTests,
  setComposedServicesForTests,
} from "../src/server/compose-services";
import {
  startNextTestServer,
  type NextTestServer,
  type RouteRegistration,
} from "./support/next-test-server";

const AUTH_USER_ID = "subscriptions-route-user-1";

const subscriptionsRouteRegistrations: ReadonlyArray<RouteRegistration> = [
  { method: "GET", pathname: "/api/subscriptions", handler: listSubscriptionsGet },
  { method: "GET", pathname: "/api/subscriptions/trash", handler: listTrashedSubscriptionsGet },
];

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  return (await response.json()) as Record<string, unknown>;
};

const sampleActiveSubscription = (): SubscriptionRecord => ({
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

const sampleTrashedSubscription = (): SubscriptionRecord => ({
  ...sampleActiveSubscription(),
  id: "sub-trashed-1",
  deletedAt: new Date("2026-06-25T00:00:00.000Z"),
});

const createSubscriptionsServiceDouble = (): SubscriptionsService => ({
  list: async (input) => {
    assert.equal(input.userId, AUTH_USER_ID);
    return [sampleActiveSubscription()];
  },
  listTrashed: async (input) => {
    assert.equal(input.userId, AUTH_USER_ID);
    return [sampleTrashedSubscription()];
  },
  create: async () => {
    throw new Error("not implemented in list route test double");
  },
  update: async () => {
    throw new Error("not implemented in list route test double");
  },
  trash: async () => {
    throw new Error("not implemented in list route test double");
  },
  restore: async () => {
    throw new Error("not implemented in list route test double");
  },
  permanentlyDelete: async () => {
    throw new Error("not implemented in list route test double");
  },
  emptyTrash: async () => {
    throw new Error("not implemented in list route test double");
  },
  purgeExpiredTrash: async () => {
    throw new Error("not implemented in list route test double");
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

  server = await startNextTestServer({ routes: subscriptionsRouteRegistrations });
});

after(async () => {
  await server.close();
  resetComposedServicesForTests();
});

afterEach(() => {
  resetPoolErrorStateForTests();
});

test("GET /api/subscriptions returns 401 without auth or guest headers", async () => {
  const response = await server.fetch("/api/subscriptions");
  const payload = await readJson(response);

  assert.equal(response.status, 401);
  assert.equal(payload.code, "auth");
  assert.equal(payload.status, 401);
});

test("GET /api/subscriptions returns 200 with active subscriptions for bearer-authenticated user", async () => {
  const response = await server.fetch("/api/subscriptions", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(payload.subscriptions));
  const subscriptions = payload.subscriptions as Array<Record<string, unknown>>;
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0]?.id, "sub-1");
  assert.equal(subscriptions[0]?.deletedAt, null);
});

test("GET /api/subscriptions/trash returns 200 with trashed subscriptions only", async () => {
  const response = await server.fetch("/api/subscriptions/trash", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(payload.subscriptions));
  const subscriptions = payload.subscriptions as Array<Record<string, unknown>>;
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0]?.id, "sub-trashed-1");
  assert.ok(subscriptions[0]?.deletedAt);
});

test("GET /api/subscriptions returns 500 internal when dependencies are degraded", async () => {
  const mockPool = createMockPool();
  attachSoftPoolErrorHandling(mockPool);
  mockPool.emit(new Error("idle client connection lost"));

  const response = await server.fetch("/api/subscriptions", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 500);
  assert.deepStrictEqual(payload, {
    code: "internal",
    message: "Internal server error",
    status: 500,
  });
});