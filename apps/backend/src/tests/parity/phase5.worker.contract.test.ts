import assert from 'node:assert/strict';
import type { Server } from 'node:net';
import test from 'node:test';

import type { AuthService } from '../../auth/service.js';
import type { AiRateLimiter } from '../../ai/rate-limit.js';
import type { AiService } from '../../ai/service.js';
import type { DeviceTokensService } from '../../device-tokens/service.js';
import type { NotesService } from '../../notes/service.js';
import type { RemindersService } from '../../reminders/service.js';
import type { SubscriptionsService } from '../../subscriptions/service.js';

process.env.DATABASE_URL ??= 'postgres://localhost:5432/ai-note-keeper-test';

const { createApiServer } = await import('../../runtime/createApiServer.js');
const { startWorker } = await import('../../worker/index.js');
const { createPgBossAdapter } = await import('../../worker/boss-adapter.js');

const createAuthServiceDouble = (): AuthService => ({
  register: async (input) => ({
    userId: 'stub-user',
    username: input.username,
    tokens: {
      accessToken: 'stub-access',
      refreshToken: 'stub-refresh',
      accessExpiresAt: Date.now() + 60_000,
      refreshExpiresAt: Date.now() + 120_000,
    },
  }),
  login: async (input) => ({
    userId: 'stub-user',
    username: input.username,
    tokens: {
      accessToken: 'stub-access',
      refreshToken: 'stub-refresh',
      accessExpiresAt: Date.now() + 60_000,
      refreshExpiresAt: Date.now() + 120_000,
    },
  }),
  refresh: async () => ({
    userId: 'stub-user',
    username: 'stub-user',
    tokens: {
      accessToken: 'stub-access',
      refreshToken: 'stub-refresh',
      accessExpiresAt: Date.now() + 60_000,
      refreshExpiresAt: Date.now() + 120_000,
    },
  }),
  logout: async () => undefined,
  upgradeSession: async (input) => ({
    userId: input.userId,
    username: 'stub-user',
    tokens: {
      accessToken: 'stub-access',
      refreshToken: 'stub-refresh',
      accessExpiresAt: Date.now() + 60_000,
      refreshExpiresAt: Date.now() + 120_000,
    },
  }),
});

const createNoopNotesService = (): NotesService => ({
  listNotes: async () => [],
  sync: async () => ({ notes: [], syncedAt: Date.now() }),
  restoreNote: async () => false,
  trashNote: async () => false,
  permanentlyDeleteNote: async () => false,
  emptyTrash: async () => 0,
  purgeExpiredTrash: async () => 0,
} as unknown as NotesService);

const createNoopRemindersService = (): RemindersService => ({
  listReminders: async () => [],
  getReminder: async () => null,
  createReminder: async () => {
    throw new Error('not implemented in parity test');
  },
  updateReminder: async () => {
    throw new Error('not implemented in parity test');
  },
  deleteReminder: async () => false,
  ackReminder: async () => null,
  snoozeReminder: async () => null,
} satisfies RemindersService);

const createNoopSubscriptionsService = (): SubscriptionsService => ({
  list: async () => [],
  create: async () => {
    throw new Error('not implemented in parity test');
  },
  update: async () => {
    throw new Error('not implemented in parity test');
  },
  trash: async () => false,
  restore: async () => false,
  permanentlyDelete: async () => false,
  purgeExpiredTrash: async () => 0,
} as unknown as SubscriptionsService);

const createNoopDeviceTokensService = (): DeviceTokensService => ({
  upsert: async () => ({
    id: 'token-id',
    userId: 'user-id',
    deviceId: 'device-id',
    fcmToken: 'fcm-token',
    platform: 'android',
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  deleteByDeviceId: async () => false,
} as unknown as DeviceTokensService);

const createNoopAiService = (): AiService => ({
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
} as unknown as AiService);

const createNoopAiRateLimiter = (): AiRateLimiter => ({
  enforce: () => undefined,
});

const startApi = async (isDependencyDegraded: () => boolean): Promise<Readonly<{
  baseUrl: string;
  close: () => Promise<void>;
}>> => {
  const app = createApiServer({
    authService: createAuthServiceDouble(),
    notesService: createNoopNotesService(),
    remindersService: createNoopRemindersService(),
    subscriptionsService: createNoopSubscriptionsService(),
    deviceTokensService: createNoopDeviceTokensService(),
    aiService: createNoopAiService(),
    aiRateLimiter: createNoopAiRateLimiter(),
    isDependencyDegraded,
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
    throw new Error('Expected TCP server address info');
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

test('phase-5 worker contract: merge routes stay behind dependency gate and auth middleware ordering', async () => {
  const degradedApi = await startApi(() => true);
  const healthyApi = await startApi(() => false);

  try {
    const degradedResponse = await fetch(`${degradedApi.baseUrl}/api/merge/preflight`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        toUserId: 'target-user',
        username: 'alice',
        password: 'password',
      }),
    });

    assert.equal(degradedResponse.status, 500);
    const degradedPayload = (await degradedResponse.json()) as {
      code: string;
      status: number;
    };
    assert.equal(degradedPayload.code, 'internal');
    assert.equal(degradedPayload.status, 500);

    const healthyResponse = await fetch(`${healthyApi.baseUrl}/api/merge/preflight`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        toUserId: 'target-user',
        username: 'alice',
        password: 'password',
      }),
    });

    assert.equal(healthyResponse.status, 401);
    const healthyPayload = (await healthyResponse.json()) as {
      code: string;
      status: number;
    };
    assert.equal(healthyPayload.code, 'auth');
    assert.equal(healthyPayload.status, 401);
  } finally {
    await degradedApi.close();
    await healthyApi.close();
  }
});

test('phase-5 worker contract: worker bootstrap exposes active phase-5 handler telemetry', async () => {
  const infoLogs: string[] = [];

  const worker = await startWorker({
    installSignalHandlers: false,
    logger: {
      info: (message: string) => {
        infoLogs.push(message);
      },
      error: (_message: string) => {
        // no-op
      },
    },
  });

  try {
    const snapshot = await worker.health();
    assert.equal(snapshot.status, 'running');

    assert.equal(typeof snapshot.details?.dispatchIntervalMs, 'number');
    assert.equal(typeof snapshot.details?.pushRetriesScheduled, 'number');
    assert.equal(typeof snapshot.details?.pushRetriesExecuted, 'number');
    assert.equal(typeof snapshot.details?.pushRetryTimersPending, 'number');
    assert.equal(typeof snapshot.details?.terminalPushFailures, 'number');

    assert.equal(
      infoLogs.some((message) => message.includes('dispatch + push handlers enabled')),
      true,
    );
  } finally {
    await worker.shutdown();
  }
});

test('phase-5 worker contract: API and worker runtimes remain independently startable and stoppable', async () => {
  const api = await startApi(() => false);
  const worker = await startWorker({
    installSignalHandlers: false,
    logger: {
      info: (_message: string) => {
        // no-op
      },
      error: (_message: string) => {
        // no-op
      },
    },
  });

  try {
    const liveBeforeShutdown = await fetch(`${api.baseUrl}/health/live`);
    assert.equal(liveBeforeShutdown.status, 200);

    await worker.shutdown();

    const liveAfterShutdown = await fetch(`${api.baseUrl}/health/live`);
    assert.equal(liveAfterShutdown.status, 200);
  } finally {
    await api.close();
  }
});

test('phase-5 worker contract: restart and retry simulation preserves idempotent dispatch side effects', async () => {
  const seenJobKeys = new Set<string>();
  let enqueued = 0;
  let duplicates = 0;
  const now = new Date('2026-04-19T00:00:00.000Z');

  const adapter = createPgBossAdapter({
    dispatchIntervalMs: 10,
    scanner: {
      scanDueReminders: async () => ({
        since: now,
        now,
        reminders: [
          {
            noteId: 'note-1',
            userId: 'user-1',
            triggerTime: now,
          },
        ],
      }),
    },
    cronStateRepository: {
      getLastCheckedAt: async () => null,
      upsertLastCheckedAt: async () => undefined,
    },
    queue: {
      enqueue: async (job) => {
        if (seenJobKeys.has(job.jobKey)) {
          duplicates += 1;
          return { status: 'duplicate' } as const;
        }

        seenJobKeys.add(job.jobKey);
        enqueued += 1;
        return { status: 'enqueued' } as const;
      },
    },
    logger: {
      info: (_message: string) => {
        // no-op
      },
      error: (_message: string) => {
        // no-op
      },
    },
  });

  const first = await startWorker({
    adapter,
    installSignalHandlers: false,
    logger: {
      info: (_message: string) => {
        // no-op
      },
      error: (_message: string) => {
        // no-op
      },
    },
  });

  await new Promise<void>((resolve) => {
    setTimeout(resolve, 30);
  });
  await first.shutdown();

  const second = await startWorker({
    adapter,
    installSignalHandlers: false,
    logger: {
      info: (_message: string) => {
        // no-op
      },
      error: (_message: string) => {
        // no-op
      },
    },
  });

  await new Promise<void>((resolve) => {
    setTimeout(resolve, 30);
  });
  await second.shutdown();

  assert.equal(enqueued, 1);
  assert.ok(duplicates >= 1);
});