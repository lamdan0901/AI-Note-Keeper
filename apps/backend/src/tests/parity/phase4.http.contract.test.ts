import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
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
  ReminderRepeatRule,
} from '../../reminders/contracts.js';
import type { RemindersRepository } from '../../reminders/repositories/reminders-repository.js';
import { createRemindersService } from '../../reminders/service.js';
import type { SubscriptionsService } from '../../subscriptions/service.js';

process.env.DATABASE_URL ??= 'postgres://localhost:5432/ai-note-keeper-test';

const require = createRequire(import.meta.url);
const { createTokenFactory } = await import('../../auth/tokens.js');
const { createApiServer } = await import('../../runtime/createApiServer.js');
const recurrenceModule = require('../../../../../packages/shared/utils/recurrence.js') as {
  computeNextTrigger: (
    now: number,
    startAt: number,
    baseAtLocal: string,
    repeat: ReminderRepeatRule | null,
    timezone?: string,
  ) => number | null;
};
const { computeNextTrigger } = recurrenceModule;

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

const createNoopNotesService = (): NotesService => {
  return {
    listNotes: async () => [],
    sync: async (input: { lastSyncAt: number }) => ({ notes: [], syncedAt: input.lastSyncAt }),
    restoreNote: async () => false,
    trashNote: async () => false,
    permanentlyDeleteNote: async () => false,
    emptyTrash: async () => 0,
    purgeExpiredTrash: async () => 0,
  } as unknown as NotesService;
};

const createNoopSubscriptionsService = (): SubscriptionsService => {
  return {
    list: async () => [],
    create: async () => {
      throw new Error('not implemented for this test');
    },
    update: async () => {
      throw new Error('not implemented for this test');
    },
    trash: async () => false,
    restore: async () => false,
    permanentlyDelete: async () => false,
    purgeExpiredTrash: async () => 0,
  } as unknown as SubscriptionsService;
};

const createNoopDeviceTokensService = (): DeviceTokensService => {
  return {
    upsert: async () => ({
      id: 'token-1',
      userId: 'user-1',
      deviceId: 'device-1',
      fcmToken: 'fcm-token',
      platform: 'android',
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    deleteByDeviceId: async () => false,
  } as unknown as DeviceTokensService;
};

const createNoopAiService = (): AiService => {
  return {
    parseVoiceNoteIntent: async (request: { transcript: string }) => ({
      draft: {
        title: null,
        content: request.transcript,
        reminderAtEpochMs: null,
        repeat: null,
        keepTranscriptInContent: true,
        normalizedTranscript: request.transcript,
      },
      confidence: {
        title: 1,
        content: 1,
        reminder: 0,
        repeat: 0,
      },
      clarification: {
        required: false,
        question: null,
        missingFields: [],
      },
    }),
    continueVoiceClarification: async (request: { priorDraft: Record<string, unknown> }) => ({
      draft: request.priorDraft,
      confidence: {
        title: 1,
        content: 1,
        reminder: 1,
        repeat: 1,
      },
      clarification: {
        required: false,
        question: null,
        missingFields: [],
      },
    }),
  } as unknown as AiService;
};

const createNoopAiRateLimiter = (): AiRateLimiter => ({
  enforce: () => undefined,
});

type ReminderHarness = Readonly<{
  remindersService: ReturnType<typeof createRemindersService>;
  setNow: (nextMs: number) => void;
  getEventAppendCount: () => number;
  getReminderHookCount: () => number;
}>;

const createReminderHarness = (): ReminderHarness => {
  const byKey = new Map<string, ReminderRecord>();
  const duplicateKeys = new Set<string>();

  let nowMs = 1_760_000_000_000;
  let eventAppendCount = 0;
  let reminderHookCount = 0;

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
      const rows = [...byKey.values()]
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

      return rows;
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
    isDuplicate: async (input) => {
      const dedupeKey = `${input.userId}:${input.noteId}:${input.operation}:${input.payloadHash}`;
      return duplicateKeys.has(dedupeKey);
    },
    appendEvent: async (input) => {
      const dedupeKey = `${input.userId}:${input.noteId}:${input.operation}:${input.payloadHash}`;
      duplicateKeys.add(dedupeKey);
      eventAppendCount += 1;
    },
  };

  const remindersService = createRemindersService({
    remindersRepository,
    noteChangeEventsRepository,
    now: () => new Date(nowMs),
    onReminderChanged: async () => {
      reminderHookCount += 1;
    },
  });

  return {
    remindersService,
    setNow: (nextMs: number) => {
      nowMs = nextMs;
    },
    getEventAppendCount: () => eventAppendCount,
    getReminderHookCount: () => reminderHookCount,
  };
};

type RunningServer = Readonly<{
  baseUrl: string;
  harness: ReminderHarness;
  close: () => Promise<void>;
}>;

const startServer = async (): Promise<RunningServer> => {
  const harness = createReminderHarness();
  const app = createApiServer({
    authService: createAuthServiceDouble(),
    notesService: createNoopNotesService(),
    remindersService: harness.remindersService,
    subscriptionsService: createNoopSubscriptionsService(),
    deviceTokensService: createNoopDeviceTokensService(),
    aiService: createNoopAiService(),
    aiRateLimiter: createNoopAiRateLimiter(),
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
    throw new Error('Expected TCP address info from test server');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    harness,
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

const parseJson = async <T>(response: Response): Promise<T> => {
  return (await response.json()) as T;
};

test('phase-4 parity: CRUD/list/get/update/delete preserve ownership and missing semantics', async () => {
  const server = await startServer();
  const ownerToken = await createAccessToken('owner-user');
  const otherToken = await createAccessToken('other-user');

  try {
    server.harness.setNow(1_760_000_000_000);

    const createResponse = await fetch(`${server.baseUrl}/api/reminders`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ownerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'rem-crud-1',
        userId: 'tampered-user',
        title: 'owner reminder',
        triggerAt: 1_760_000_000_000,
        active: true,
        timezone: 'UTC',
        updatedAt: 1_760_000_000_000,
      }),
    });

    assert.equal(createResponse.status, 200);
    const createdBody = await parseJson<{ reminder: { userId: string; id: string } }>(
      createResponse,
    );
    assert.equal(createdBody.reminder.userId, 'owner-user');
    assert.equal(createdBody.reminder.id, 'rem-crud-1');

    const ownerList = await fetch(`${server.baseUrl}/api/reminders`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(ownerList.status, 200);
    const ownerListBody = await parseJson<{ reminders: Array<{ id: string; userId: string }> }>(
      ownerList,
    );
    assert.equal(ownerListBody.reminders.length, 1);
    assert.equal(ownerListBody.reminders[0].id, 'rem-crud-1');
    assert.equal(ownerListBody.reminders[0].userId, 'owner-user');

    const otherList = await fetch(`${server.baseUrl}/api/reminders`, {
      headers: { authorization: `Bearer ${otherToken}` },
    });
    assert.equal(otherList.status, 200);
    const otherListBody = await parseJson<{ reminders: Array<{ id: string }> }>(otherList);
    assert.equal(otherListBody.reminders.length, 0);

    const foreignGet = await fetch(`${server.baseUrl}/api/reminders/rem-crud-1`, {
      headers: { authorization: `Bearer ${otherToken}` },
    });
    assert.equal(foreignGet.status, 200);
    assert.deepEqual(await parseJson(foreignGet), { reminder: null });

    const foreignPatch = await fetch(`${server.baseUrl}/api/reminders/rem-crud-1`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${otherToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'attacker title',
        updatedAt: 1_760_000_000_100,
      }),
    });
    assert.equal(foreignPatch.status, 200);
    assert.deepEqual(await parseJson(foreignPatch), { updated: false, reminder: null });

    const ownerPatch = await fetch(`${server.baseUrl}/api/reminders/rem-crud-1`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${ownerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'owner reminder updated',
        updatedAt: 1_760_000_000_500,
      }),
    });
    assert.equal(ownerPatch.status, 200);
    const ownerPatchBody = await parseJson<{
      updated: boolean;
      reminder: { title: string | null } | null;
    }>(ownerPatch);
    assert.equal(ownerPatchBody.updated, true);
    assert.equal(ownerPatchBody.reminder?.title, 'owner reminder updated');

    const foreignDelete = await fetch(`${server.baseUrl}/api/reminders/rem-crud-1`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${otherToken}` },
    });
    assert.equal(foreignDelete.status, 200);
    assert.deepEqual(await parseJson(foreignDelete), { deleted: false });

    const ownerDelete = await fetch(`${server.baseUrl}/api/reminders/rem-crud-1`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(ownerDelete.status, 200);
    assert.deepEqual(await parseJson(ownerDelete), { deleted: true });

    const ownerGetMissing = await fetch(`${server.baseUrl}/api/reminders/rem-crud-1`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(ownerGetMissing.status, 200);
    assert.deepEqual(await parseJson(ownerGetMissing), { reminder: null });
  } finally {
    await server.close();
  }
});

test('phase-4 parity: ack transitions for recurring and one-time reminders', async () => {
  const server = await startServer();
  const token = await createAccessToken('user-ack');

  try {
    server.harness.setNow(1_760_100_000_000);

    const recurringCreate = await fetch(`${server.baseUrl}/api/reminders`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'rem-ack-recurring',
        title: 'recurring',
        triggerAt: 1_760_100_000_000,
        active: true,
        timezone: 'UTC',
        repeat: { kind: 'daily', interval: 1 },
        startAt: 1_760_100_000_000,
        baseAtLocal: '2026-01-15T09:00:00',
        updatedAt: 1_760_100_000_000,
      }),
    });

    assert.equal(recurringCreate.status, 200);

    server.harness.setNow(1_760_100_100_000);
    const recurringAck = await fetch(`${server.baseUrl}/api/reminders/rem-ack-recurring/ack`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ackType: 'done' }),
    });

    assert.equal(recurringAck.status, 200);
    const recurringAckBody = await parseJson<{
      updated: boolean;
      reminder: {
        done: boolean | null;
        scheduleStatus: string;
        nextTriggerAt: string | null;
        lastAcknowledgedAt: string | null;
        lastFiredAt: string | null;
      } | null;
    }>(recurringAck);

    assert.equal(recurringAckBody.updated, true);
    assert.equal(recurringAckBody.reminder?.done, true);
    assert.equal(recurringAckBody.reminder?.scheduleStatus, 'scheduled');
    assert.notEqual(recurringAckBody.reminder?.nextTriggerAt, null);
    assert.notEqual(recurringAckBody.reminder?.lastAcknowledgedAt, null);
    assert.notEqual(recurringAckBody.reminder?.lastFiredAt, null);

    const oneTimeCreate = await fetch(`${server.baseUrl}/api/reminders`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'rem-ack-once',
        title: 'one time',
        triggerAt: 1_760_200_000_000,
        active: true,
        timezone: 'UTC',
        updatedAt: 1_760_200_000_000,
      }),
    });
    assert.equal(oneTimeCreate.status, 200);

    server.harness.setNow(1_760_200_100_000);
    const oneTimeAck = await fetch(`${server.baseUrl}/api/reminders/rem-ack-once/ack`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ackType: 'done' }),
    });

    assert.equal(oneTimeAck.status, 200);
    const oneTimeAckBody = await parseJson<{
      updated: boolean;
      reminder: {
        done: boolean | null;
        scheduleStatus: string;
        nextTriggerAt: string | null;
        snoozedUntil: string | null;
        lastAcknowledgedAt: string | null;
      } | null;
    }>(oneTimeAck);

    assert.equal(oneTimeAckBody.updated, true);
    assert.equal(oneTimeAckBody.reminder?.done, true);
    assert.equal(oneTimeAckBody.reminder?.scheduleStatus, 'unscheduled');
    assert.equal(oneTimeAckBody.reminder?.nextTriggerAt, null);
    assert.equal(oneTimeAckBody.reminder?.snoozedUntil, null);
    assert.notEqual(oneTimeAckBody.reminder?.lastAcknowledgedAt, null);
  } finally {
    await server.close();
  }
});

test('phase-4 parity: snooze updates due state deterministically and preserves recurrence fields', async () => {
  const server = await startServer();
  const token = await createAccessToken('user-snooze');

  try {
    server.harness.setNow(1_760_300_000_000);

    const createResponse = await fetch(`${server.baseUrl}/api/reminders`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'rem-snooze-1',
        title: 'weekly reminder',
        triggerAt: 1_760_300_000_000,
        active: true,
        timezone: 'America/New_York',
        repeat: { kind: 'weekly', interval: 1, weekdays: [1, 3, 5] },
        startAt: 1_760_300_000_000,
        baseAtLocal: '2026-03-01T08:30:00',
        updatedAt: 1_760_300_000_000,
      }),
    });
    assert.equal(createResponse.status, 200);

    const snoozedUntil = 1_760_360_000_000;
    server.harness.setNow(1_760_320_000_000);
    const snoozeResponse = await fetch(`${server.baseUrl}/api/reminders/rem-snooze-1/snooze`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ snoozedUntil }),
    });

    assert.equal(snoozeResponse.status, 200);
    const snoozeBody = await parseJson<{
      updated: boolean;
      reminder: {
        snoozedUntil: string | null;
        nextTriggerAt: string | null;
        scheduleStatus: string;
        repeat: ReminderRepeatRule | null;
        timezone: string;
        baseAtLocal: string | null;
        startAt: string | null;
      } | null;
    }>(snoozeResponse);

    assert.equal(snoozeBody.updated, true);
    assert.equal(Date.parse(snoozeBody.reminder?.snoozedUntil ?? ''), snoozedUntil);
    assert.equal(Date.parse(snoozeBody.reminder?.nextTriggerAt ?? ''), snoozedUntil);
    assert.equal(snoozeBody.reminder?.scheduleStatus, 'scheduled');
    assert.deepEqual(snoozeBody.reminder?.repeat, {
      kind: 'weekly',
      interval: 1,
      weekdays: [1, 3, 5],
    });
    assert.equal(snoozeBody.reminder?.timezone, 'America/New_York');
    assert.equal(snoozeBody.reminder?.baseAtLocal, '2026-03-01T08:30:00');
    assert.notEqual(snoozeBody.reminder?.startAt, null);
  } finally {
    await server.close();
  }
});

test('phase-4 parity: stale/equal timestamp updates are no-op and do not append change events', async () => {
  const server = await startServer();
  const token = await createAccessToken('user-noop');

  try {
    server.harness.setNow(1_760_400_000_000);

    const createResponse = await fetch(`${server.baseUrl}/api/reminders`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'rem-noop-1',
        title: 'original title',
        triggerAt: 1_760_400_000_000,
        active: true,
        timezone: 'UTC',
        updatedAt: 1_760_400_000_000,
      }),
    });

    assert.equal(createResponse.status, 200);
    assert.equal(server.harness.getEventAppendCount(), 1);
    assert.equal(server.harness.getReminderHookCount(), 1);

    const equalUpdate = await fetch(`${server.baseUrl}/api/reminders/rem-noop-1`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'equal update ignored',
        updatedAt: 1_760_400_000_000,
      }),
    });

    assert.equal(equalUpdate.status, 200);
    const equalBody = await parseJson<{
      updated: boolean;
      reminder: { title: string | null } | null;
    }>(equalUpdate);
    assert.equal(equalBody.updated, false);
    assert.equal(equalBody.reminder?.title, 'original title');

    const staleUpdate = await fetch(`${server.baseUrl}/api/reminders/rem-noop-1`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'stale update ignored',
        updatedAt: 1_760_399_999_999,
      }),
    });

    assert.equal(staleUpdate.status, 200);
    const staleBody = await parseJson<{
      updated: boolean;
      reminder: { title: string | null } | null;
    }>(staleUpdate);
    assert.equal(staleBody.updated, false);
    assert.equal(staleBody.reminder?.title, 'original title');

    assert.equal(server.harness.getEventAppendCount(), 1);
    assert.equal(server.harness.getReminderHookCount(), 1);

    const effectiveUpdate = await fetch(`${server.baseUrl}/api/reminders/rem-noop-1`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'effective update',
        updatedAt: 1_760_400_000_100,
      }),
    });

    assert.equal(effectiveUpdate.status, 200);
    const effectiveBody = await parseJson<{
      updated: boolean;
      reminder: { title: string | null } | null;
    }>(effectiveUpdate);
    assert.equal(effectiveBody.updated, true);
    assert.equal(effectiveBody.reminder?.title, 'effective update');
    assert.equal(server.harness.getEventAppendCount(), 2);
    assert.equal(server.harness.getReminderHookCount(), 2);
  } finally {
    await server.close();
  }
});

test('phase-4 parity: recurrence definition edits recompute nextTrigger with shared utility semantics', async () => {
  const server = await startServer();
  const token = await createAccessToken('user-recur');

  try {
    const startAt = Date.parse('2026-03-08T06:30:00.000Z');

    server.harness.setNow(1_760_500_000_000);
    const createResponse = await fetch(`${server.baseUrl}/api/reminders`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'rem-recur-1',
        title: 'dst-aware reminder',
        triggerAt: startAt,
        active: true,
        timezone: 'America/New_York',
        repeat: { kind: 'daily', interval: 1 },
        startAt,
        baseAtLocal: '2026-03-08T01:30:00',
        updatedAt: 1_760_500_000_000,
      }),
    });

    assert.equal(createResponse.status, 200);
    const createdBody = await parseJson<{
      reminder: {
        nextTriggerAt: string | null;
      };
    }>(createResponse);
    const firstNextTrigger = Date.parse(createdBody.reminder.nextTriggerAt ?? '');
    assert.equal(Number.isNaN(firstNextTrigger), false);

    const patchNow = 1_760_500_100_000;
    server.harness.setNow(patchNow);

    const nextRepeat: ReminderRepeatRule = {
      kind: 'weekly',
      interval: 1,
      weekdays: [1, 4],
    };

    const updateResponse = await fetch(`${server.baseUrl}/api/reminders/rem-recur-1`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        repeat: nextRepeat,
        baseAtLocal: '2026-03-08T02:30:00',
        startAt,
        timezone: 'America/New_York',
        updatedAt: 1_760_500_100_000,
      }),
    });

    assert.equal(updateResponse.status, 200);
    const updatedBody = await parseJson<{
      updated: boolean;
      reminder: {
        repeat: ReminderRepeatRule | null;
        nextTriggerAt: string | null;
      } | null;
    }>(updateResponse);

    assert.equal(updatedBody.updated, true);
    assert.deepEqual(updatedBody.reminder?.repeat, nextRepeat);

    const expectedNextTrigger = computeNextTrigger(
      patchNow,
      startAt,
      '2026-03-08T02:30:00',
      nextRepeat,
      'America/New_York',
    );

    assert.notEqual(updatedBody.reminder?.nextTriggerAt, null);
    assert.notEqual(expectedNextTrigger, null);
    assert.equal(Date.parse(updatedBody.reminder?.nextTriggerAt ?? ''), expectedNextTrigger);
  } finally {
    await server.close();
  }
});
