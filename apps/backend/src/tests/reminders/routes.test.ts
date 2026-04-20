import assert from 'node:assert/strict';
import type { Server } from 'node:net';
import test from 'node:test';

import express from 'express';

import { errorMiddleware, notFoundMiddleware } from '../../middleware/error-middleware.js';
import type { ReminderRecord, ReminderUpdatePayload } from '../../reminders/contracts.js';
import type { RemindersService } from '../../reminders/service.js';

process.env.DATABASE_URL ??= 'postgres://localhost:5432/ai-note-keeper-test';

const { createTokenFactory } = await import('../../auth/tokens.js');
const { createRemindersRoutes } = await import('../../reminders/routes.js');

const createReminder = (
  input: Readonly<{
    id: string;
    userId: string;
    updatedAt: number;
    title?: string | null;
  }>,
): ReminderRecord => {
  const updatedAt = new Date(input.updatedAt);

  return {
    id: input.id,
    userId: input.userId,
    title: input.title ?? null,
    triggerAt: updatedAt,
    done: null,
    repeatRule: 'none',
    repeatConfig: null,
    repeat: null,
    snoozedUntil: null,
    active: true,
    scheduleStatus: 'scheduled',
    timezone: 'UTC',
    baseAtLocal: null,
    startAt: null,
    nextTriggerAt: updatedAt,
    lastFiredAt: null,
    lastAcknowledgedAt: null,
    version: 1,
    createdAt: updatedAt,
    updatedAt,
  };
};

const createServiceDouble = (): RemindersService &
  Readonly<{ byKey: Map<string, ReminderRecord> }> => {
  const byKey = new Map<string, ReminderRecord>();

  const key = (userId: string, reminderId: string): string => `${userId}:${reminderId}`;

  return {
    byKey,
    listReminders: async ({ userId, updatedSince }) => {
      return [...byKey.values()].filter((item) => {
        if (item.userId !== userId) {
          return false;
        }

        if (updatedSince === undefined) {
          return true;
        }

        return item.updatedAt.getTime() > updatedSince;
      });
    },
    getReminder: async ({ userId, reminderId }) => {
      return byKey.get(key(userId, reminderId)) ?? null;
    },
    createReminder: async (input) => {
      const created = createReminder({
        id: input.id,
        userId: input.userId,
        updatedAt: input.updatedAt ?? Date.now(),
        title: input.title ?? null,
      });

      byKey.set(key(created.userId, created.id), created);
      return created;
    },
    updateReminder: async ({ userId, reminderId, patch }) => {
      const existing = byKey.get(key(userId, reminderId));
      if (!existing) {
        return null;
      }

      if (patch.updatedAt <= existing.updatedAt.getTime()) {
        return existing;
      }

      const next = {
        ...existing,
        ...(Object.hasOwn(patch as Record<string, unknown>, 'title')
          ? { title: patch.title ?? null }
          : {}),
        updatedAt: new Date(patch.updatedAt),
      };

      byKey.set(key(userId, reminderId), next);
      return next;
    },
    deleteReminder: async ({ userId, reminderId }) => {
      return byKey.delete(key(userId, reminderId));
    },
    ackReminder: async ({ userId, reminderId }) => {
      const existing = byKey.get(key(userId, reminderId));
      if (!existing) {
        return null;
      }

      const next = {
        ...existing,
        done: true,
        updatedAt: new Date(Date.now()),
      };
      byKey.set(key(userId, reminderId), next);
      return next;
    },
    snoozeReminder: async ({ userId, reminderId, snoozedUntil }) => {
      const existing = byKey.get(key(userId, reminderId));
      if (!existing) {
        return null;
      }

      const snoozeDate = new Date(snoozedUntil);
      const next = {
        ...existing,
        snoozedUntil: snoozeDate,
        nextTriggerAt: snoozeDate,
        updatedAt: new Date(Date.now()),
      };
      byKey.set(key(userId, reminderId), next);
      return next;
    },
  };
};

const startServer = async (
  service: RemindersService,
): Promise<Readonly<{ baseUrl: string; close: () => Promise<void> }>> => {
  const app = express();
  app.use(express.json());
  app.use('/api/reminders', createRemindersRoutes(service));
  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

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
  const pair = await tokenFactory.issueTokenPair({
    userId,
    username: userId,
  });

  return pair.accessToken;
};

test('unauthorized reminder endpoints return auth error envelope', async () => {
  const service = createServiceDouble();
  const server = await startServer(service);

  try {
    const response = await fetch(`${server.baseUrl}/api/reminders`);
    assert.equal(response.status, 401);

    const payload = (await response.json()) as { code: string; message: string; status: number };
    assert.deepEqual(Object.keys(payload).sort(), ['code', 'message', 'status']);
    assert.equal(payload.code, 'auth');
    assert.equal(payload.status, 401);
  } finally {
    await server.close();
  }
});

test('missing reminder operations return parity 200 nullable and boolean payloads', async () => {
  const service = createServiceDouble();
  const server = await startServer(service);
  const token = await createAccessToken('user-1');

  try {
    const getResponse = await fetch(`${server.baseUrl}/api/reminders/missing`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(getResponse.status, 200);
    assert.deepEqual(await getResponse.json(), { reminder: null });

    const updateResponse = await fetch(`${server.baseUrl}/api/reminders/missing`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        updatedAt: 1_700_000_000_000,
        title: 'ignored',
      } satisfies ReminderUpdatePayload),
    });
    assert.equal(updateResponse.status, 200);
    assert.deepEqual(await updateResponse.json(), { updated: false, reminder: null });

    const deleteResponse = await fetch(`${server.baseUrl}/api/reminders/missing`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(deleteResponse.status, 200);
    assert.deepEqual(await deleteResponse.json(), { deleted: false });

    const ackResponse = await fetch(`${server.baseUrl}/api/reminders/missing/ack`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ackType: 'done' }),
    });
    assert.equal(ackResponse.status, 200);
    assert.deepEqual(await ackResponse.json(), { updated: false, reminder: null });

    const snoozeResponse = await fetch(`${server.baseUrl}/api/reminders/missing/snooze`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ snoozedUntil: 1_700_000_000_000 }),
    });
    assert.equal(snoozeResponse.status, 200);
    assert.deepEqual(await snoozeResponse.json(), { updated: false, reminder: null });
  } finally {
    await server.close();
  }
});

test('list endpoint supports updatedSince and keeps user ownership scoping', async () => {
  const service = createServiceDouble();
  service.byKey.set(
    'user-1:r-old',
    createReminder({ id: 'r-old', userId: 'user-1', updatedAt: 100 }),
  );
  service.byKey.set(
    'user-1:r-new',
    createReminder({ id: 'r-new', userId: 'user-1', updatedAt: 300 }),
  );
  service.byKey.set(
    'user-2:r-foreign',
    createReminder({ id: 'r-foreign', userId: 'user-2', updatedAt: 400 }),
  );

  const server = await startServer(service);
  const token = await createAccessToken('user-1');

  try {
    const response = await fetch(`${server.baseUrl}/api/reminders?updatedSince=200`, {
      headers: { authorization: `Bearer ${token}` },
    });

    const listBody = await response.text();
    assert.equal(response.status, 200, listBody);
    const payload = JSON.parse(listBody) as { reminders: Array<{ id: string; userId: string }> };
    assert.equal(payload.reminders.length, 1);
    assert.equal(payload.reminders[0].id, 'r-new');
    assert.equal(payload.reminders[0].userId, 'user-1');
  } finally {
    await server.close();
  }
});

test('request body userId tampering is ignored in create and update flows', async () => {
  const service = createServiceDouble();
  const server = await startServer(service);
  const token = await createAccessToken('user-1');

  try {
    const createResponse = await fetch(`${server.baseUrl}/api/reminders`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'reminder-1',
        userId: 'attacker-user',
        title: 'first',
        triggerAt: 1_700_000_100_000,
        active: true,
        timezone: 'UTC',
      }),
    });

    assert.equal(createResponse.status, 200);
    const created = (await createResponse.json()) as { reminder: { userId: string } };
    assert.equal(created.reminder.userId, 'user-1');

    service.byKey.set(
      'user-2:reminder-1',
      createReminder({
        id: 'reminder-1',
        userId: 'user-2',
        updatedAt: 1_700_000_000_000,
        title: 'foreign',
      }),
    );

    const updateResponse = await fetch(`${server.baseUrl}/api/reminders/reminder-1`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        userId: 'user-2',
        updatedAt: Date.now() + 1_000,
        title: 'owner-update',
      }),
    });

    assert.equal(updateResponse.status, 200);
    const payload = (await updateResponse.json()) as {
      updated: boolean;
      reminder: { title: string | null } | null;
    };

    assert.equal(payload.updated, true);
    assert.equal(payload.reminder?.title, 'owner-update');
    assert.equal(service.byKey.get('user-1:reminder-1')?.title, 'owner-update');
    assert.equal(service.byKey.get('user-2:reminder-1')?.title, 'foreign');
  } finally {
    await server.close();
  }
});
