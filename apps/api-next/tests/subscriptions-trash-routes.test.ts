import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { after, afterEach, before, test } from "node:test";
import { NextRequest } from "next/server";

import { createTokenFactory } from "@backend/auth/tokens";
import type { SubscriptionsService } from "@backend/subscriptions/service";

import { DELETE as trashSubscriptionDelete } from "../app/api/subscriptions/[subscriptionId]/route";
import { DELETE as permanentDelete } from "../app/api/subscriptions/[subscriptionId]/permanent/route";
import { POST as restoreSubscriptionPost } from "../app/api/subscriptions/[subscriptionId]/restore/route";
import { DELETE as emptyTrashDelete } from "../app/api/subscriptions/trash/empty/route";
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

const AUTH_USER_ID = "subscriptions-trash-route-user-1";

const subscriptionsTrashRouteRegistrations: ReadonlyArray<RouteRegistration> = [
  {
    method: "DELETE",
    pathname: "/api/subscriptions/trash/empty",
    handler: emptyTrashDelete,
  },
  {
    method: "POST",
    pathname: "/api/subscriptions/:subscriptionId/restore",
    pattern: "/api/subscriptions/:subscriptionId/restore",
    handler: restoreSubscriptionPost,
  },
  {
    method: "DELETE",
    pathname: "/api/subscriptions/:subscriptionId/permanent",
    pattern: "/api/subscriptions/:subscriptionId/permanent",
    handler: permanentDelete,
  },
  {
    method: "DELETE",
    pathname: "/api/subscriptions/:subscriptionId",
    pattern: "/api/subscriptions/:subscriptionId",
    handler: trashSubscriptionDelete,
  },
];

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  return (await response.json()) as Record<string, unknown>;
};

const createSubscriptionsServiceDouble = () => {
  const calls: Array<{ method: string; args: Record<string, unknown> }> = [];

  const subscriptionsService: SubscriptionsService = {
    list: async () => {
      throw new Error("not implemented in trash route test double");
    },
    listTrashed: async () => {
      throw new Error("not implemented in trash route test double");
    },
    create: async () => {
      throw new Error("not implemented in trash route test double");
    },
    update: async () => {
      throw new Error("not implemented in trash route test double");
    },
    restore: async (input) => {
      calls.push({ method: "restore", args: input as Record<string, unknown> });
      return true;
    },
    trash: async (input) => {
      calls.push({ method: "trash", args: input as Record<string, unknown> });
      return true;
    },
    permanentlyDelete: async (input) => {
      calls.push({
        method: "permanentlyDelete",
        args: input as Record<string, unknown>,
      });
      return true;
    },
    emptyTrash: async (input) => {
      calls.push({ method: "emptyTrash", args: input as Record<string, unknown> });
      return 2;
    },
    purgeExpiredTrash: async () => {
      throw new Error("not implemented in trash route test double");
    },
  };

  return { subscriptionsService, calls };
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
let accessToken: string;
let serviceCalls: Array<{ method: string; args: Record<string, unknown> }>;

before(async () => {
  const { subscriptionsService, calls } = createSubscriptionsServiceDouble();
  serviceCalls = calls;

  const services = composeServices();
  setComposedServicesForTests({
    ...services,
    subscriptionsService,
  });

  const tokenFactory = createTokenFactory();
  const tokens = await tokenFactory.issueTokenPair({
    userId: AUTH_USER_ID,
    username: "alice",
  });
  accessToken = tokens.accessToken;

  server = await startNextTestServer({ routes: subscriptionsTrashRouteRegistrations });
});

after(async () => {
  await server.close();
  resetComposedServicesForTests();
});

afterEach(() => {
  resetPoolErrorStateForTests();
  serviceCalls.length = 0;
});

test("trash lifecycle routes return 401 without auth or guest headers", async () => {
  const trash = await server.fetch("/api/subscriptions/sub-2", { method: "DELETE" });
  const restore = await server.fetch("/api/subscriptions/sub-2/restore", { method: "POST" });
  const permanent = await server.fetch("/api/subscriptions/sub-2/permanent", { method: "DELETE" });
  const empty = await server.fetch("/api/subscriptions/trash/empty", { method: "DELETE" });

  for (const response of [trash, restore, permanent, empty]) {
    const payload = await readJson(response);
    assert.equal(response.status, 401);
    assert.equal(payload.code, "auth");
    assert.equal(payload.status, 401);
  }
});

test("DELETE /api/subscriptions/:subscriptionId soft-deletes and returns { deleted: boolean }", async () => {
  const response = await server.fetch("/api/subscriptions/sub-trash-1", {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepStrictEqual(payload, { deleted: true });
  assert.equal(serviceCalls.length, 1);
  assert.equal(serviceCalls[0]?.method, "trash");
  assert.deepStrictEqual(serviceCalls[0]?.args, {
    userId: AUTH_USER_ID,
    subscriptionId: "sub-trash-1",
  });
});

test("POST /api/subscriptions/:subscriptionId/restore returns { restored: boolean }", async () => {
  const response = await server.fetch("/api/subscriptions/sub-restore-1/restore", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepStrictEqual(payload, { restored: true });
  assert.equal(serviceCalls[0]?.method, "restore");
  assert.deepStrictEqual(serviceCalls[0]?.args, {
    userId: AUTH_USER_ID,
    subscriptionId: "sub-restore-1",
  });
});

test("DELETE /api/subscriptions/:subscriptionId/permanent returns { deleted: boolean }", async () => {
  const response = await server.fetch("/api/subscriptions/sub-permanent-1/permanent", {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepStrictEqual(payload, { deleted: true });
  assert.equal(serviceCalls[0]?.method, "permanentlyDelete");
  assert.deepStrictEqual(serviceCalls[0]?.args, {
    userId: AUTH_USER_ID,
    subscriptionId: "sub-permanent-1",
  });
});

test("DELETE /api/subscriptions/trash/empty returns { deleted: number }", async () => {
  const response = await server.fetch("/api/subscriptions/trash/empty", {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepStrictEqual(payload, { deleted: 2 });
  assert.equal(serviceCalls[0]?.method, "emptyTrash");
  assert.deepStrictEqual(serviceCalls[0]?.args, { userId: AUTH_USER_ID });
});

test("invalid subscriptionId param returns 400 validation", async () => {
  const request = new NextRequest("http://localhost/api/subscriptions/invalid/restore", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const response = await restoreSubscriptionPost(request, {
    params: Promise.resolve({ subscriptionId: "" }),
  });
  const payload = await readJson(response);

  assert.equal(response.status, 400);
  assert.equal(payload.code, "validation");
  assert.equal(serviceCalls.length, 0);
});

test("restore, permanent delete, and empty trash routes map to lifecycle operations", async () => {
  const trash = await server.fetch("/api/subscriptions/sub-2", {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(trash.status, 200);
  assert.deepStrictEqual(await trash.json(), { deleted: true });

  const restore = await server.fetch("/api/subscriptions/sub-2/restore", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(restore.status, 200);
  assert.deepStrictEqual(await restore.json(), { restored: true });

  await server.fetch("/api/subscriptions/sub-2", {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });

  const permanent = await server.fetch("/api/subscriptions/sub-2/permanent", {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(permanent.status, 200);
  assert.deepStrictEqual(await permanent.json(), { deleted: true });

  const empty = await server.fetch("/api/subscriptions/trash/empty", {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(empty.status, 200);
  assert.deepStrictEqual(await empty.json(), { deleted: 2 });
});

test("DELETE /api/subscriptions/:subscriptionId returns 500 internal when dependencies are degraded", async () => {
  const mockPool = createMockPool();
  attachSoftPoolErrorHandling(mockPool);
  mockPool.emit(new Error("idle client connection lost"));

  const response = await server.fetch("/api/subscriptions/sub-2", {
    method: "DELETE",
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