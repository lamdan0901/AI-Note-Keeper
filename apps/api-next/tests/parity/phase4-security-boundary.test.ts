import assert from "node:assert/strict";
import { test } from "node:test";

import { authHeaders } from "../support/reminders-test-server";
import {
  createAccessToken,
  jsonAuthHeaders,
  startPhase4RemindersParityTestServer,
} from "../support/phase4-reminders-parity-test-server";

const assertAuthEnvelope = async (response: Response): Promise<void> => {
  const payload = (await response.json()) as { code: string; message: string; status: number };
  assert.equal(response.status, 401);
  assert.deepEqual(Object.keys(payload).sort(), ["code", "message", "status"]);
  assert.equal(payload.code, "auth");
  assert.equal(payload.status, 401);
};

const assertErrorEnvelopeShape = (payload: {
  code?: unknown;
  message?: unknown;
  status?: unknown;
}): void => {
  assert.equal(typeof payload.code, "string");
  assert.equal(typeof payload.message, "string");
  assert.equal(typeof payload.status, "number");
};

test("phase-4 security: unauthorized reminder endpoints return stable auth envelope", async () => {
  const server = await startPhase4RemindersParityTestServer();

  try {
    await assertAuthEnvelope(await server.fetch("/api/reminders"));

    await assertAuthEnvelope(
      await server.fetch("/api/reminders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "unauth-create",
          title: "blocked",
          triggerAt: 1_760_700_000_000,
          active: true,
          timezone: "UTC",
        }),
      }),
    );

    await assertAuthEnvelope(
      await server.fetch("/api/reminders/unauth-id", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "blocked", updatedAt: 1_760_700_000_010 }),
      }),
    );

    await assertAuthEnvelope(
      await server.fetch("/api/reminders/unauth-id/ack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ackType: "done" }),
      }),
    );

    await assertAuthEnvelope(
      await server.fetch("/api/reminders/unauth-id/snooze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snoozedUntil: 1_760_700_000_050 }),
      }),
    );
  } finally {
    await server.close();
  }
});

test("phase-4 security: malformed reminder payloads return validation envelope with issues", async () => {
  const server = await startPhase4RemindersParityTestServer();
  const token = await createAccessToken("validation-user");

  try {
    const invalidTimezoneCreate = await server.fetch("/api/reminders", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        id: "invalid-timezone",
        title: "bad timezone",
        triggerAt: 1_760_700_000_000,
        active: true,
        timezone: "",
      }),
    });

    assert.equal(invalidTimezoneCreate.status, 400);
    const timezonePayload = (await invalidTimezoneCreate.json()) as {
      code: string;
      status: number;
      details?: { issues?: ReadonlyArray<unknown> };
    };
    assert.equal(timezonePayload.code, "validation");
    assert.equal(timezonePayload.status, 400);
    assert.ok((timezonePayload.details?.issues?.length ?? 0) > 0);

    const invalidRepeatCreate = await server.fetch("/api/reminders", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        id: "invalid-repeat",
        title: "bad repeat",
        triggerAt: 1_760_700_000_000,
        active: true,
        timezone: "UTC",
        repeat: { kind: "weekly", interval: 1 },
      }),
    });

    assert.equal(invalidRepeatCreate.status, 400);
    const repeatPayload = (await invalidRepeatCreate.json()) as {
      code: string;
      status: number;
      details?: { issues?: ReadonlyArray<unknown> };
    };
    assert.equal(repeatPayload.code, "validation");
    assert.equal(repeatPayload.status, 400);
    assert.ok((repeatPayload.details?.issues?.length ?? 0) > 0);

    const invalidAckAction = await server.fetch("/api/reminders/invalid-repeat/ack", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({ ackType: "invalid-action" }),
    });

    assert.equal(invalidAckAction.status, 400);
    const ackPayload = (await invalidAckAction.json()) as {
      code: string;
      status: number;
      details?: { issues?: ReadonlyArray<unknown> };
    };
    assert.equal(ackPayload.code, "validation");
    assert.equal(ackPayload.status, 400);
    assert.ok((ackPayload.details?.issues?.length ?? 0) > 0);
  } finally {
    await server.close();
  }
});

test("phase-4 security: cross-user mutations cannot modify foreign reminders", async () => {
  const server = await startPhase4RemindersParityTestServer();
  const ownerToken = await createAccessToken("owner-user");
  const attackerToken = await createAccessToken("attacker-user");

  try {
    const createResponse = await server.fetch("/api/reminders", {
      method: "POST",
      headers: jsonAuthHeaders(ownerToken),
      body: JSON.stringify({
        id: "cross-user-reminder",
        title: "owner-only",
        triggerAt: 1_760_700_000_000,
        active: true,
        timezone: "UTC",
        updatedAt: 1_760_700_000_000,
      }),
    });

    assert.equal(createResponse.status, 200);

    const attackerPatch = await server.fetch("/api/reminders/cross-user-reminder", {
      method: "PATCH",
      headers: jsonAuthHeaders(attackerToken),
      body: JSON.stringify({ title: "attacker-update", updatedAt: 1_760_700_000_100 }),
    });
    assert.equal(attackerPatch.status, 200);
    assert.deepEqual(await attackerPatch.json(), { updated: false, reminder: null });

    const attackerAck = await server.fetch("/api/reminders/cross-user-reminder/ack", {
      method: "POST",
      headers: jsonAuthHeaders(attackerToken),
      body: JSON.stringify({ ackType: "done" }),
    });
    assert.equal(attackerAck.status, 200);
    assert.deepEqual(await attackerAck.json(), { updated: false, reminder: null });

    const attackerSnooze = await server.fetch("/api/reminders/cross-user-reminder/snooze", {
      method: "POST",
      headers: jsonAuthHeaders(attackerToken),
      body: JSON.stringify({ snoozedUntil: 1_760_700_100_000 }),
    });
    assert.equal(attackerSnooze.status, 200);
    assert.deepEqual(await attackerSnooze.json(), { updated: false, reminder: null });

    const attackerDelete = await server.fetch("/api/reminders/cross-user-reminder", {
      method: "DELETE",
      headers: authHeaders(attackerToken),
    });
    assert.equal(attackerDelete.status, 200);
    assert.deepEqual(await attackerDelete.json(), { deleted: false });

    const ownerGet = await server.fetch("/api/reminders/cross-user-reminder", {
      headers: authHeaders(ownerToken),
    });
    assert.equal(ownerGet.status, 200);
    const ownerBody = (await ownerGet.json()) as {
      reminder: {
        title: string | null;
        userId: string;
      } | null;
    };

    assert.equal(ownerBody.reminder?.title, "owner-only");
    assert.equal(ownerBody.reminder?.userId, "owner-user");
  } finally {
    await server.close();
  }
});

test("phase-4 security: mounted reminder routes preserve stable non-2xx error contracts", async () => {
  const server = await startPhase4RemindersParityTestServer();
  const token = await createAccessToken("error-contract-user");

  try {
    const validationResponse = await server.fetch("/api/reminders", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        id: "error-contract-reminder",
        title: "missing required fields",
      }),
    });

    assert.equal(validationResponse.status, 400);
    const validationPayload = (await validationResponse.json()) as {
      code?: unknown;
      message?: unknown;
      status?: unknown;
      details?: unknown;
    };
    assertErrorEnvelopeShape(validationPayload);
    assert.equal(validationPayload.code, "validation");

    const missingRouteResponse = await server.fetch(
      "/api/reminders/error-contract-reminder/unknown-action",
      {
        method: "POST",
        headers: authHeaders(token),
      },
    );

    assert.equal(missingRouteResponse.status, 404);
    const missingRoutePayload = (await missingRouteResponse.json()) as {
      code?: unknown;
      message?: unknown;
      status?: unknown;
    };
    assertErrorEnvelopeShape(missingRoutePayload);
    assert.equal(missingRoutePayload.code, "not_found");
  } finally {
    await server.close();
  }
});