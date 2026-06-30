import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_GUEST_USER_ID,
  guestHeaders,
} from "./support/notes-test-server";
import {
  createRemindersServiceDouble,
  DEFAULT_REMINDERS_AUTH_USER_ID,
} from "./support/reminders-service-double";
import {
  authHeaders,
  remindersRouteRegistrations,
  startRemindersTestServer,
} from "./support/reminders-test-server";

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  return (await response.json()) as Record<string, unknown>;
};

const jsonAuthHeaders = (token: string): Headers => {
  const headers = authHeaders(token);
  headers.set("content-type", "application/json");
  return headers;
};

const minimalCreateBody = () => ({
  id: "harness-reminder-1",
  triggerAt: 1_700_000_100_000,
  active: true,
  timezone: "UTC",
});

test("reminders test harness binds an ephemeral port instead of :3001", async () => {
  const server = await startRemindersTestServer();

  try {
    assert.notEqual(server.port, 3001);
    assert.match(server.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  } finally {
    await server.close();
  }
});

test("reminders test harness registers all 7 reminder routes", () => {
  const methodsByPath = new Map<string, Set<string>>();

  for (const route of remindersRouteRegistrations) {
    const path = route.pattern ?? route.pathname;
    const methods = methodsByPath.get(path) ?? new Set<string>();
    methods.add(route.method);
    methodsByPath.set(path, methods);
  }

  assert.deepEqual(
    [...methodsByPath.keys()].sort(),
    [
      "/api/reminders",
      "/api/reminders/:reminderId",
      "/api/reminders/:reminderId/ack",
      "/api/reminders/:reminderId/snooze",
    ].sort(),
  );
  assert.deepEqual([...(methodsByPath.get("/api/reminders") ?? [])].sort(), ["GET", "POST"]);
  assert.deepEqual(
    [...(methodsByPath.get("/api/reminders/:reminderId") ?? [])].sort(),
    ["DELETE", "GET", "PATCH"],
  );
  assert.deepEqual([...(methodsByPath.get("/api/reminders/:reminderId/ack") ?? [])], ["POST"]);
  assert.deepEqual([...(methodsByPath.get("/api/reminders/:reminderId/snooze") ?? [])], ["POST"]);
});

test("reminders test harness rejects guest headers with 401 on list", async () => {
  const server = await startRemindersTestServer();

  try {
    const response = await server.fetch("/api/reminders", {
      headers: guestHeaders({
        platform: "web",
        guestUserId: DEFAULT_GUEST_USER_ID,
      }),
    });
    const payload = await readJson(response);

    assert.equal(response.status, 401);
    assert.equal(payload.code, "auth");
    assert.equal(payload.message, "Access token is required");
  } finally {
    await server.close();
  }
});

test("reminders test harness rejects guest headers with 401 on create", async () => {
  const server = await startRemindersTestServer();

  try {
    const response = await server.fetch("/api/reminders", {
      method: "POST",
      headers: {
        ...Object.fromEntries(
          guestHeaders({ platform: "mobile", guestUserId: DEFAULT_GUEST_USER_ID }).entries(),
        ),
        "content-type": "application/json",
      },
      body: JSON.stringify(minimalCreateBody()),
    });
    const payload = await readJson(response);

    assert.equal(response.status, 401);
    assert.equal(payload.code, "auth");
    assert.equal(payload.message, "Access token is required");
    assert.equal(server.createCalls.length, 0);
  } finally {
    await server.close();
  }
});

test("reminders test harness dispatches GET /api/reminders with bearer auth", async () => {
  const remindersService = createRemindersServiceDouble(DEFAULT_REMINDERS_AUTH_USER_ID);
  remindersService.seed({
    id: "harness-list-1",
    userId: DEFAULT_REMINDERS_AUTH_USER_ID,
    title: "Harness",
    content: "secret",
    contentType: "text/plain",
    triggerAt: new Date(1_700_000_100_000),
    done: null,
    repeatRule: "none",
    repeatConfig: null,
    repeat: null,
    snoozedUntil: null,
    active: true,
    scheduleStatus: "scheduled",
    timezone: "UTC",
    baseAtLocal: null,
    startAt: null,
    nextTriggerAt: new Date(1_700_000_100_000),
    lastFiredAt: null,
    lastAcknowledgedAt: null,
    scheduleProvider: "qstash",
    scheduleTargetId: "target-1",
    scheduleTargetVersion: 1,
    scheduleTargetFireAt: new Date("2026-01-01T00:00:00.000Z"),
    version: 1,
    createdAt: new Date(1_700_000_100_000),
    updatedAt: new Date(1_700_000_100_000),
  });

  const server = await startRemindersTestServer({ remindersService });

  try {
    const response = await server.fetch("/api/reminders", {
      headers: authHeaders(server.accessToken),
    });
    const payload = await readJson(response);

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(payload.reminders));
    assert.equal(remindersService.listCalls.length, 1);
    assert.equal(remindersService.listCalls[0]?.userId, DEFAULT_REMINDERS_AUTH_USER_ID);
  } finally {
    await server.close();
  }
});

test("reminders test harness passes updatedSince query to listReminders", async () => {
  const remindersService = createRemindersServiceDouble(DEFAULT_REMINDERS_AUTH_USER_ID);
  const server = await startRemindersTestServer({ remindersService });

  try {
    const response = await server.fetch("/api/reminders?updatedSince=12345", {
      headers: authHeaders(server.accessToken),
    });

    assert.equal(response.status, 200);
    assert.equal(remindersService.listCalls.length, 1);
    assert.equal(remindersService.listCalls[0]?.updatedSince, 12345);
  } finally {
    await server.close();
  }
});

test("reminders test harness dispatches dynamic [reminderId] routes", async () => {
  const remindersService = createRemindersServiceDouble(DEFAULT_REMINDERS_AUTH_USER_ID);
  remindersService.seed({
    id: "harness-dynamic-1",
    userId: DEFAULT_REMINDERS_AUTH_USER_ID,
    title: "Dynamic",
    content: "secret",
    contentType: "text/plain",
    triggerAt: new Date(1_700_000_000_000),
    done: null,
    repeatRule: "none",
    repeatConfig: null,
    repeat: null,
    snoozedUntil: null,
    active: true,
    scheduleStatus: "scheduled",
    timezone: "UTC",
    baseAtLocal: null,
    startAt: null,
    nextTriggerAt: new Date(1_700_000_000_000),
    lastFiredAt: null,
    lastAcknowledgedAt: null,
    scheduleProvider: "qstash",
    scheduleTargetId: "target-1",
    scheduleTargetVersion: 1,
    scheduleTargetFireAt: new Date("2026-01-01T00:00:00.000Z"),
    version: 1,
    createdAt: new Date(1_700_000_000_000),
    updatedAt: new Date(1_700_000_000_000),
  });

  const server = await startRemindersTestServer({ remindersService });

  try {
    const getResponse = await server.fetch("/api/reminders/harness-dynamic-1", {
      headers: authHeaders(server.accessToken),
    });
    assert.equal(getResponse.status, 200);
    const getPayload = (await getResponse.json()) as { reminder: { id: string } | null };
    assert.equal(getPayload.reminder?.id, "harness-dynamic-1");

    const patchResponse = await server.fetch("/api/reminders/harness-dynamic-1", {
      method: "PATCH",
      headers: jsonAuthHeaders(server.accessToken),
      body: JSON.stringify({
        updatedAt: 1_700_000_100_000,
        title: "Updated",
      }),
    });
    assert.equal(patchResponse.status, 200);
    const patchPayload = (await patchResponse.json()) as {
      updated: boolean;
      reminder: { title: string | null } | null;
    };
    assert.equal(patchPayload.updated, true);
    assert.equal(patchPayload.reminder?.title, "Updated");

    const ackResponse = await server.fetch("/api/reminders/harness-dynamic-1/ack", {
      method: "POST",
      headers: jsonAuthHeaders(server.accessToken),
      body: JSON.stringify({ ackType: "done" }),
    });
    assert.equal(ackResponse.status, 200);
    const ackPayload = (await ackResponse.json()) as { updated: boolean };
    assert.equal(ackPayload.updated, true);

    const snoozeResponse = await server.fetch("/api/reminders/harness-dynamic-1/snooze", {
      method: "POST",
      headers: jsonAuthHeaders(server.accessToken),
      body: JSON.stringify({ snoozedUntil: 1_700_000_500_000 }),
    });
    assert.equal(snoozeResponse.status, 200);
    const snoozePayload = (await snoozeResponse.json()) as { updated: boolean };
    assert.equal(snoozePayload.updated, true);

    const deleteResponse = await server.fetch("/api/reminders/harness-dynamic-1", {
      method: "DELETE",
      headers: authHeaders(server.accessToken),
    });
    assert.equal(deleteResponse.status, 200);
    const deletePayload = (await deleteResponse.json()) as { deleted: boolean };
    assert.equal(deletePayload.deleted, true);
  } finally {
    await server.close();
  }
});