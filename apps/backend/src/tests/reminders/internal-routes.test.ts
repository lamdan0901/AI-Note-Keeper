import assert from 'node:assert/strict';
import type { Server } from 'node:net';
import test from 'node:test';

import express from 'express';

import { errorMiddleware, notFoundMiddleware } from '../../middleware/error-middleware.js';
import { createReminderInternalRoutes } from '../../reminders/internal-routes.js';
import type { QstashVerifierConfig } from '../../reminders/runtime.js';
import type { ScheduledTaskExecutor } from '../../reminders/scheduled-task-executor.js';

const verifierConfig: QstashVerifierConfig = {
  currentSigningKey: 'current-signing-key',
  nextSigningKey: 'next-signing-key',
  callbackUrl: 'https://api.example.test/internal/reminders/scheduled-task',
};

const startServer = async (
  executor: ScheduledTaskExecutor,
  verify: (input: Readonly<{ signature: string; body: string; url: string }>) => Promise<boolean>,
): Promise<Readonly<{ url: string; close: () => Promise<void> }>> => {
  const app = express();
  app.use(
    express.json({
      verify: (request, _response, buffer) => {
        (request as typeof request & { rawBody?: string }).rawBody = buffer.toString('utf8');
      },
    }),
  );
  app.use(
    '/internal/reminders',
    createReminderInternalRoutes({
      executor,
      verifierConfig,
      verify,
    }),
  );
  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  const server = await new Promise<Server>((resolve, reject) => {
    const running = app.listen(0, '127.0.0.1', () => resolve(running));
    running.once('error', reject);
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object');

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () =>
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      }),
  };
};

test('internal scheduled task route requires Upstash signature', async () => {
  const executor: ScheduledTaskExecutor = {
    execute: async () => ({ status: 'sent' }),
  };
  const server = await startServer(executor, async () => true);

  try {
    const response = await fetch(`${server.url}/internal/reminders/scheduled-task`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reminderId: 'reminder-1',
        occurrenceAt: '2026-06-13T10:05:00.000Z',
        version: 1,
        deliveryKey: 'key',
      }),
    });

    assert.equal(response.status, 401);
  } finally {
    await server.close();
  }
});

test('internal scheduled task route verifies exact raw body and callback url before executing', async () => {
  const executed: string[] = [];
  const verified: Array<Readonly<{ signature: string; body: string; url: string }>> = [];
  const executor: ScheduledTaskExecutor = {
    execute: async (payload) => {
      executed.push(payload.reminderId);
      return { status: 'sent' };
    },
  };
  const server = await startServer(executor, async (input) => {
    verified.push(input);
    return true;
  });
  const body = JSON.stringify({
    reminderId: 'reminder-1',
    occurrenceAt: '2026-06-13T10:05:00.000Z',
    version: 1,
    deliveryKey: 'key',
  });

  try {
    const response = await fetch(`${server.url}/internal/reminders/scheduled-task`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Upstash-Signature': 'signed-jwt',
      },
      body,
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'sent' });
    assert.deepEqual(executed, ['reminder-1']);
    assert.deepEqual(verified, [
      {
        signature: 'signed-jwt',
        body,
        url: 'https://api.example.test/internal/reminders/scheduled-task',
      },
    ]);
  } finally {
    await server.close();
  }
});

test('internal scheduled task route rejects failed QStash verification', async () => {
  const executed: string[] = [];
  const executor: ScheduledTaskExecutor = {
    execute: async (payload) => {
      executed.push(payload.reminderId);
      return { status: 'sent' };
    },
  };
  const server = await startServer(executor, async () => false);

  try {
    const response = await fetch(`${server.url}/internal/reminders/scheduled-task`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Upstash-Signature': 'bad-signature',
      },
      body: JSON.stringify({
        reminderId: 'reminder-1',
        occurrenceAt: '2026-06-13T10:05:00.000Z',
        version: 1,
        deliveryKey: 'key',
      }),
    });

    assert.equal(response.status, 401);
    assert.deepEqual(executed, []);
  } finally {
    await server.close();
  }
});
