import assert from 'node:assert/strict';
import type { Server } from 'node:net';
import test from 'node:test';

import type { AuthService } from '../../auth/service.js';
import type { AiRateLimiter } from '../../ai/rate-limit.js';
import type { AiService } from '../../ai/service.js';
import type { DeviceTokensService } from '../../device-tokens/service.js';
import type { NoteChangeEventsRepository } from '../../notes/repositories/note-change-events-repository.js';
import type { NotesService } from '../../notes/service.js';
import type {
  ReminderCreateInput,
  ReminderPatchInput,
  ReminderRecord,
} from '../../reminders/contracts.js';
import type { RemindersRepository } from '../../reminders/repositories/reminders-repository.js';
import { createRemindersService } from '../../reminders/service.js';
import type { SubscriptionsService } from '../../subscriptions/service.js';

process.env.DATABASE_URL ??= 'postgres://localhost:5432/ai-note-keeper-test';

const { createTokenFactory } = await import('../../auth/tokens.js');
const { createApiServer } = await import('../../runtime/createApiServer.js');

const createAuthServiceDouble = (): AuthService => ({
  register: async (input) => ({
    userId: 'user-register',
    username: input.username,
    tokens: {
      accessToken: 'access-register',
      refreshToken: 'refresh-register',
      accessExpiresAt: Date.now() + 60_000,
      refreshExpiresAt: Date.now() + 120_000,
    },
  }),
  login: async (input) => ({
    userId: 'user-login',
    username: input.username,
    tokens: {
      accessToken: 'access-login',
      refreshToken: 'refresh-login',
      accessExpiresAt: Date.now() + 60_000,
      refreshExpiresAt: Date.now() + 120_000,
    },
  }),
  refresh: async () => ({
    userId: 'user-refresh',
    username: 'refresh-user',
    tokens: {
      accessToken: 'access-refresh',
      refreshToken: 'refresh-refresh',
      accessExpiresAt: Date.now() + 60_000,
      refreshExpiresAt: Date.now() + 120_000,
    },
  }),
  logout: async () => undefined,
  upgradeSession: async (input) => ({
    userId: input.userId,
    username: 'legacy-user',
    tokens: {
      accessToken: 'access-upgrade',
      refreshToken: 'refresh-upgrade',
      accessExpiresAt: Date.now() + 60_000,
      refreshExpiresAt: Date.now() + 120_000,
    },
  }),
});

const createReminderHarness = (): ReturnType<typeof createRemindersService> => {
  const byKey = new Map<string, ReminderRecord>();
  const key = (userId: string, reminderId: string): string => `${userId}:${reminderId}`;

  const cloneReminder = (value: ReminderRecord): ReminderRecord => {
    return {
      ...value,
      triggerAt: new Date(value.triggerAt.getTime()),
      repeatConfig: value.repeatConfig ? { ...value.repeatConfig } : null,
      repeat: value.repeat ? structuredClone(value.repeat) : null,
      snoozedUntil: value.snoozedUntil ? new Date(value.snoozedUntil.getTime()) : null,
      startAt: value.startAt ? new Date(value.startAt.getTime()) : null,
      nextTriggerAt: value.nextTriggerAt ? new Date(value.nextTriggerAt.getTime()) : null,
      lastFiredAt: value.lastFiredAt ? new Date(value.lastFiredAt.getTime()) : null,
      lastAcknowledgedAt: value.lastAcknowledgedAt
        ? new Date(value.lastAcknowledgedAt.getTime())
        : null,
      createdAt: new Date(value.createdAt.getTime()),
      updatedAt: new Date(value.updatedAt.getTime()),
    };
  };

  const applyPatch = (current: ReminderRecord, patch: ReminderPatchInput): ReminderRecord => {
    return {
      ...current,
      repeatConfig: current.repeatConfig ? { ...current.repeatConfig } : null,
      repeat: current.repeat ? structuredClone(current.repeat) : null,
      ...(Object.hasOwn(patch, 'title') ? { title: patch.title ?? null } : {}),
      ...(Object.hasOwn(patch, 'triggerAt')
        ? { triggerAt: patch.triggerAt ?? current.triggerAt }
        : {}),
      ...(Object.hasOwn(patch, 'done') ? { done: patch.done ?? null } : {}),
      ...(Object.hasOwn(patch, 'repeatRule') ? { repeatRule: patch.repeatRule ?? null } : {}),
      ...(Object.hasOwn(patch, 'repeatConfig') ? { repeatConfig: patch.repeatConfig ?? null } : {}),
      ...(Object.hasOwn(patch, 'repeat') ? { repeat: patch.repeat ?? null } : {}),
      ...(Object.hasOwn(patch, 'snoozedUntil') ? { snoozedUntil: patch.snoozedUntil ?? null } : {}),
      ...(Object.hasOwn(patch, 'active') ? { active: patch.active ?? true } : {}),
      ...(Object.hasOwn(patch, 'scheduleStatus')
        ? { scheduleStatus: patch.scheduleStatus ?? 'unscheduled' }
        : {}),
      ...(Object.hasOwn(patch, 'timezone') ? { timezone: patch.timezone ?? 'UTC' } : {}),
      ...(Object.hasOwn(patch, 'baseAtLocal') ? { baseAtLocal: patch.baseAtLocal ?? null } : {}),
      ...(Object.hasOwn(patch, 'startAt') ? { startAt: patch.startAt ?? null } : {}),
      ...(Object.hasOwn(patch, 'nextTriggerAt')
        ? { nextTriggerAt: patch.nextTriggerAt ?? null }
        : {}),
      ...(Object.hasOwn(patch, 'lastFiredAt') ? { lastFiredAt: patch.lastFiredAt ?? null } : {}),
      ...(Object.hasOwn(patch, 'lastAcknowledgedAt')
        ? { lastAcknowledgedAt: patch.lastAcknowledgedAt ?? null }
        : {}),
      ...(Object.hasOwn(patch, 'version') ? { version: patch.version ?? 1 } : {}),
      ...(Object.hasOwn(patch, 'updatedAt')
        ? { updatedAt: patch.updatedAt ?? current.updatedAt }
        : {}),
    };
  };

  const remindersRepository: RemindersRepository = {
    listByUser: async ({ userId, updatedSince }) => {
      return [...byKey.values()]
        .filter((item) => {
          if (item.userId !== userId) {
            return false;
          }

          if (!updatedSince) {
            return true;
          }

          return item.updatedAt.getTime() > updatedSince.getTime();
        })
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
        .map(cloneReminder);
    },
    findByIdForUser: async ({ reminderId, userId }) => {
      const found = byKey.get(key(userId, reminderId));
      return found ? cloneReminder(found) : null;
    },
    create: async (input: ReminderCreateInput) => {
      const created: ReminderRecord = {
        id: input.id,
        userId: input.userId,
        title: input.title,
        triggerAt: input.triggerAt,
        done: input.done,
        repeatRule: input.repeatRule,
        repeatConfig: input.repeatConfig,
        repeat: input.repeat,
        snoozedUntil: input.snoozedUntil,
        active: input.active,
        scheduleStatus: input.scheduleStatus,
        timezone: input.timezone,
        baseAtLocal: input.baseAtLocal,
        startAt: input.startAt,
        nextTriggerAt: input.nextTriggerAt,
        lastFiredAt: input.lastFiredAt,
        lastAcknowledgedAt: input.lastAcknowledgedAt,
        version: input.version,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      };

      byKey.set(key(created.userId, created.id), cloneReminder(created));
      return cloneReminder(created);
    },
    patch: async ({ reminderId, userId, patch }) => {
      const current = byKey.get(key(userId, reminderId));
      if (!current) {
        return null;
      }

      const next = applyPatch(cloneReminder(current), patch);
      byKey.set(key(userId, reminderId), cloneReminder(next));
      return cloneReminder(next);
    },
    deleteByIdForUser: async ({ reminderId, userId }) => {
      return byKey.delete(key(userId, reminderId));
    },
  };

  const noteChangeEventsRepository: NoteChangeEventsRepository = {
    isDuplicate: async () => false,
    appendEvent: async () => undefined,
  };

  return createRemindersService({
    remindersRepository,
    noteChangeEventsRepository,
    now: () => new Date(1_760_700_000_000),
  });
};

const startServer = async () => {
  const app = createApiServer({
    authService: createAuthServiceDouble(),
    notesService: {} as NotesService,
    remindersService: createReminderHarness(),
    subscriptionsService: {} as SubscriptionsService,
    deviceTokensService: {} as DeviceTokensService,
    aiService: {} as AiService,
    aiRateLimiter: { enforce: () => undefined } as AiRateLimiter,
    isDependencyDegraded: () => false,
    readinessProbe: async () => ({
      ok: true,
      service: 'backend',
      checks: {
        database: 'up',
        migrations: 'up',
      },
    }),
  });

  const server = await new Promise<Server>((resolve, reject) => {
    const running = app.listen(0, '127.0.0.1', () => resolve(running));
    running.once('error', reject);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP server address');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
};

const createAccessToken = async (userId: string): Promise<string> => {
  const tokenFactory = createTokenFactory();
  const pair = await tokenFactory.issueTokenPair({ userId, username: userId });
  return pair.accessToken;
};

const assertAuthEnvelope = async (response: Response): Promise<void> => {
  const payload = (await response.json()) as { code: string; message: string; status: number };
  assert.equal(response.status, 401);
  assert.deepEqual(Object.keys(payload).sort(), ['code', 'message', 'status']);
  assert.equal(payload.code, 'auth');
  assert.equal(payload.status, 401);
};

const assertErrorEnvelopeShape = (payload: {
  code?: unknown;
  message?: unknown;
  status?: unknown;
}): void => {
  assert.equal(typeof payload.code, 'string');
  assert.equal(typeof payload.message, 'string');
  assert.equal(typeof payload.status, 'number');
};

test('phase-4 security: unauthorized reminder endpoints return stable auth envelope', async () => {
  const server = await startServer();

  try {
    await assertAuthEnvelope(await fetch(`${server.baseUrl}/api/reminders`));

    await assertAuthEnvelope(
      await fetch(`${server.baseUrl}/api/reminders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'unauth-create',
          title: 'blocked',
          triggerAt: 1_760_700_000_000,
          active: true,
          timezone: 'UTC',
        }),
      }),
    );

    await assertAuthEnvelope(
      await fetch(`${server.baseUrl}/api/reminders/unauth-id`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'blocked', updatedAt: 1_760_700_000_010 }),
      }),
    );

    await assertAuthEnvelope(
      await fetch(`${server.baseUrl}/api/reminders/unauth-id/ack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ackType: 'done' }),
      }),
    );

    await assertAuthEnvelope(
      await fetch(`${server.baseUrl}/api/reminders/unauth-id/snooze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ snoozedUntil: 1_760_700_000_050 }),
      }),
    );
  } finally {
    await server.close();
  }
});

test('phase-4 security: malformed reminder payloads return validation envelope with issues', async () => {
  const server = await startServer();
  const token = await createAccessToken('validation-user');

  try {
    const invalidTimezoneCreate = await fetch(`${server.baseUrl}/api/reminders`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'invalid-timezone',
        title: 'bad timezone',
        triggerAt: 1_760_700_000_000,
        active: true,
        timezone: '',
      }),
    });

    assert.equal(invalidTimezoneCreate.status, 400);
    const timezonePayload = (await invalidTimezoneCreate.json()) as {
      code: string;
      status: number;
      details?: { issues?: ReadonlyArray<unknown> };
    };
    assert.equal(timezonePayload.code, 'validation');
    assert.equal(timezonePayload.status, 400);
    assert.ok((timezonePayload.details?.issues?.length ?? 0) > 0);

    const invalidRepeatCreate = await fetch(`${server.baseUrl}/api/reminders`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'invalid-repeat',
        title: 'bad repeat',
        triggerAt: 1_760_700_000_000,
        active: true,
        timezone: 'UTC',
        repeat: { kind: 'weekly', interval: 1 },
      }),
    });

    assert.equal(invalidRepeatCreate.status, 400);
    const repeatPayload = (await invalidRepeatCreate.json()) as {
      code: string;
      status: number;
      details?: { issues?: ReadonlyArray<unknown> };
    };
    assert.equal(repeatPayload.code, 'validation');
    assert.equal(repeatPayload.status, 400);
    assert.ok((repeatPayload.details?.issues?.length ?? 0) > 0);

    const invalidAckAction = await fetch(`${server.baseUrl}/api/reminders/invalid-repeat/ack`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ackType: 'invalid-action' }),
    });

    assert.equal(invalidAckAction.status, 400);
    const ackPayload = (await invalidAckAction.json()) as {
      code: string;
      status: number;
      details?: { issues?: ReadonlyArray<unknown> };
    };
    assert.equal(ackPayload.code, 'validation');
    assert.equal(ackPayload.status, 400);
    assert.ok((ackPayload.details?.issues?.length ?? 0) > 0);
  } finally {
    await server.close();
  }
});

test('phase-4 security: cross-user mutations cannot modify foreign reminders', async () => {
  const server = await startServer();
  const ownerToken = await createAccessToken('owner-user');
  const attackerToken = await createAccessToken('attacker-user');

  try {
    const createResponse = await fetch(`${server.baseUrl}/api/reminders`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ownerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'cross-user-reminder',
        title: 'owner-only',
        triggerAt: 1_760_700_000_000,
        active: true,
        timezone: 'UTC',
        updatedAt: 1_760_700_000_000,
      }),
    });

    assert.equal(createResponse.status, 200);

    const attackerPatch = await fetch(`${server.baseUrl}/api/reminders/cross-user-reminder`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${attackerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'attacker-update', updatedAt: 1_760_700_000_100 }),
    });
    assert.equal(attackerPatch.status, 200);
    assert.deepEqual(await attackerPatch.json(), { updated: false, reminder: null });

    const attackerAck = await fetch(`${server.baseUrl}/api/reminders/cross-user-reminder/ack`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${attackerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ackType: 'done' }),
    });
    assert.equal(attackerAck.status, 200);
    assert.deepEqual(await attackerAck.json(), { updated: false, reminder: null });

    const attackerSnooze = await fetch(
      `${server.baseUrl}/api/reminders/cross-user-reminder/snooze`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${attackerToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ snoozedUntil: 1_760_700_100_000 }),
      },
    );
    assert.equal(attackerSnooze.status, 200);
    assert.deepEqual(await attackerSnooze.json(), { updated: false, reminder: null });

    const attackerDelete = await fetch(`${server.baseUrl}/api/reminders/cross-user-reminder`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${attackerToken}`,
      },
    });
    assert.equal(attackerDelete.status, 200);
    assert.deepEqual(await attackerDelete.json(), { deleted: false });

    const ownerGet = await fetch(`${server.baseUrl}/api/reminders/cross-user-reminder`, {
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });
    assert.equal(ownerGet.status, 200);
    const ownerBody = (await ownerGet.json()) as {
      reminder: {
        title: string | null;
        userId: string;
      } | null;
    };

    assert.equal(ownerBody.reminder?.title, 'owner-only');
    assert.equal(ownerBody.reminder?.userId, 'owner-user');
  } finally {
    await server.close();
  }
});

test('phase-4 security: mounted reminder routes preserve stable non-2xx error contracts', async () => {
  const server = await startServer();
  const token = await createAccessToken('error-contract-user');

  try {
    const validationResponse = await fetch(`${server.baseUrl}/api/reminders`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'error-contract-reminder',
        title: 'missing required fields',
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
    assert.equal(validationPayload.code, 'validation');

    const missingRouteResponse = await fetch(
      `${server.baseUrl}/api/reminders/error-contract-reminder/unknown-action`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
    );

    assert.equal(missingRouteResponse.status, 404);
    const missingRoutePayload = (await missingRouteResponse.json()) as {
      code?: unknown;
      message?: unknown;
      status?: unknown;
    };
    assertErrorEnvelopeShape(missingRoutePayload);
    assert.equal(missingRoutePayload.code, 'not_found');
  } finally {
    await server.close();
  }
});
