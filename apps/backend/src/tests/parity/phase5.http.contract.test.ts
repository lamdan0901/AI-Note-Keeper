import assert from 'node:assert/strict';
import type { Server } from 'node:net';
import test from 'node:test';

import type { AuthService } from '../../auth/service.js';
import type { AiRateLimiter } from '../../ai/rate-limit.js';
import type { AiService } from '../../ai/service.js';
import type { DeviceTokensService } from '../../device-tokens/service.js';
import type { MergeApplyInput, MergePreflightInput } from '../../merge/contracts.js';
import { AppError } from '../../middleware/error-middleware.js';
import type { NotesService } from '../../notes/service.js';
import type { RemindersService } from '../../reminders/service.js';
import type { SubscriptionsService } from '../../subscriptions/service.js';
import { createPushJobHandler } from '../../jobs/push/push-job-handler.js';
import type {
  PushDeliveryRequest,
  PushDeliveryResult,
  PushDeliveryService,
  PushRetryJobPayload,
  PushRetryScheduler,
} from '../../jobs/push/contracts.js';

process.env.DATABASE_URL ??= 'postgres://localhost:5432/ai-note-keeper-test';

const { createTokenFactory } = await import('../../auth/tokens.js');
const { createApiServer } = await import('../../runtime/createApiServer.js');

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

const createNoopNotesService = (): NotesService =>
  ({
    listNotes: async () => [],
    sync: async () => ({ notes: [], syncedAt: Date.now() }),
    restoreNote: async () => false,
    trashNote: async () => false,
    permanentlyDeleteNote: async () => false,
    emptyTrash: async () => 0,
    purgeExpiredTrash: async () => 0,
  }) as unknown as NotesService;

const createNoopRemindersService = (): RemindersService =>
  ({
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
  }) satisfies RemindersService;

const createNoopSubscriptionsService = (): SubscriptionsService =>
  ({
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
  }) as unknown as SubscriptionsService;

const createNoopDeviceTokensService = (): DeviceTokensService =>
  ({
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
  }) as unknown as DeviceTokensService;

const createNoopAiService = (): AiService =>
  ({
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
  }) as unknown as AiService;

const createNoopAiRateLimiter = (): AiRateLimiter => ({
  enforce: () => undefined,
});

type TransactionStats = {
  started: number;
  committed: number;
  rolledBack: number;
};

const createMergeServiceDouble = (transactionStats: TransactionStats) => {
  const runInTransaction = async <T>(operation: () => Promise<T>): Promise<T> => {
    transactionStats.started += 1;

    try {
      const result = await operation();
      transactionStats.committed += 1;
      return result;
    } catch (error) {
      transactionStats.rolledBack += 1;
      throw error;
    }
  };

  const createSummary = (targetNotes: number) => ({
    sourceEmpty: false,
    sourceSampleOnly: false,
    targetEmpty: false,
    hasConflicts: true,
    sourceCounts: {
      notes: 4,
      subscriptions: 2,
      tokens: 1,
      events: 1,
    },
    targetCounts: {
      notes: targetNotes,
      subscriptions: 2,
      tokens: 1,
      events: 1,
    },
  });

  return {
    preflight: async (_input: MergePreflightInput) => {
      return await runInTransaction(async () => ({
        summary: createSummary(2),
      }));
    },

    apply: async (input: MergeApplyInput) => {
      return await runInTransaction(async () => {
        if (input.password === 'blocked') {
          throw new AppError({
            code: 'rate_limit',
            details: {
              retryAfterSeconds: 12,
              resetAt: 1_700_000_012_000,
              internalStack: 'omit-me',
            },
          });
        }

        if (input.strategy === 'cloud') {
          return {
            strategy: 'cloud' as const,
            resolution: 'cloud' as const,
            summary: createSummary(2),
          };
        }

        if (input.strategy === 'local') {
          return {
            strategy: 'local' as const,
            resolution: 'local' as const,
            summary: createSummary(4),
          };
        }

        return {
          strategy: 'both' as const,
          resolution: 'prompt' as const,
          summary: createSummary(5),
        };
      });
    },
  };
};

const startServer = async (transactionStats: TransactionStats) => {
  const app = createApiServer({
    authService: createAuthServiceDouble(),
    notesService: createNoopNotesService(),
    remindersService: createNoopRemindersService(),
    subscriptionsService: createNoopSubscriptionsService(),
    deviceTokensService: createNoopDeviceTokensService(),
    mergeService: createMergeServiceDouble(transactionStats),
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
    throw new Error('Expected TCP address');
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

test('phase-5 parity HTTP: merge preflight returns parity summary and apply enforces strategy enum', async () => {
  const transactionStats: TransactionStats = {
    started: 0,
    committed: 0,
    rolledBack: 0,
  };
  const server = await startServer(transactionStats);
  const token = await createAccessToken('source-user');

  try {
    const preflight = await fetch(`${server.baseUrl}/api/merge/preflight`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        toUserId: 'target-user',
        username: 'target-username',
        password: 'secret',
      }),
    });

    assert.equal(preflight.status, 200);
    const preflightPayload = (await preflight.json()) as {
      summary: {
        sourceCounts: Record<string, number>;
        targetCounts: Record<string, number>;
      };
    };

    assert.deepEqual(Object.keys(preflightPayload.summary.sourceCounts).sort(), [
      'events',
      'notes',
      'subscriptions',
      'tokens',
    ]);
    assert.deepEqual(Object.keys(preflightPayload.summary.targetCounts).sort(), [
      'events',
      'notes',
      'subscriptions',
      'tokens',
    ]);

    const invalidApply = await fetch(`${server.baseUrl}/api/merge/apply`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        toUserId: 'target-user',
        username: 'target-username',
        password: 'secret',
        strategy: 'hybrid',
      }),
    });

    assert.equal(invalidApply.status, 400);
    const invalidPayload = (await invalidApply.json()) as { code: string; status: number };
    assert.equal(invalidPayload.code, 'validation');
    assert.equal(invalidPayload.status, 400);
  } finally {
    await server.close();
  }
});

test('phase-5 parity HTTP: merge apply supports cloud/local/both and preserves transaction accounting', async () => {
  const transactionStats: TransactionStats = {
    started: 0,
    committed: 0,
    rolledBack: 0,
  };
  const server = await startServer(transactionStats);
  const token = await createAccessToken('source-user');

  try {
    const strategies = ['cloud', 'local', 'both'] as const;
    const expectedNotes = {
      cloud: 2,
      local: 4,
      both: 5,
    } as const;

    for (const strategy of strategies) {
      const response = await fetch(`${server.baseUrl}/api/merge/apply`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          toUserId: 'target-user',
          username: 'target-username',
          password: 'secret',
          strategy,
        }),
      });

      assert.equal(response.status, 200);
      const payload = (await response.json()) as {
        strategy: string;
        resolution: string;
        summary: { targetCounts: { notes: number } };
      };

      assert.equal(payload.strategy, strategy);
      assert.equal(payload.summary.targetCounts.notes, expectedNotes[strategy]);

      if (strategy === 'both') {
        assert.equal(payload.resolution, 'prompt');
      }
    }

    assert.equal(transactionStats.started, 3);
    assert.equal(transactionStats.committed, 3);
    assert.equal(transactionStats.rolledBack, 0);

    const blocked = await fetch(`${server.baseUrl}/api/merge/apply`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        toUserId: 'target-user',
        username: 'target-username',
        password: 'blocked',
        strategy: 'local',
      }),
    });

    assert.equal(blocked.status, 429);
    const blockedPayload = (await blocked.json()) as {
      code: string;
      details?: Record<string, unknown>;
    };
    assert.equal(blockedPayload.code, 'rate_limit');
    assert.equal(blockedPayload.details?.retryAfterSeconds, 12);
    assert.equal(blockedPayload.details?.resetAt, 1_700_000_012_000);
    assert.equal(
      Object.prototype.hasOwnProperty.call(blockedPayload.details ?? {}, 'internalStack'),
      false,
    );
  } finally {
    await server.close();
  }
});

test('phase-5 parity HTTP: push failure path keeps retry and stale-token cleanup semantics with worker doubles', async () => {
  const scheduledRetries: Array<Readonly<{ delayMs: number; job: PushRetryJobPayload }>> = [];
  const deletedTokens: Array<Readonly<{ userId: string; deviceId: string }>> = [];

  const deliveryService: PushDeliveryService = {
    deliverToToken: async (request: PushDeliveryRequest): Promise<PushDeliveryResult> => {
      if (request.token.deviceId === 'retry-device') {
        return {
          classification: 'transient_failure',
          statusCode: 429,
        };
      }

      if (request.token.deviceId === 'stale-device') {
        return {
          classification: 'unregistered',
          statusCode: 404,
          errorCode: 'UNREGISTERED',
        };
      }

      return {
        classification: 'delivered',
      };
    },
  };

  const retryScheduler: PushRetryScheduler = {
    scheduleRetry: async ({ delayMs, job }) => {
      scheduledRetries.push({ delayMs, job });
    },
  };

  const handler = createPushJobHandler({
    deliveryService,
    deviceTokensRepository: {
      deleteByDeviceIdForUser: async (input) => {
        deletedTokens.push(input);
        return true;
      },
    },
    retryScheduler,
    terminalFailureRecorder: {
      record: async () => undefined,
    },
  });

  const result = await handler.handle({
    userId: 'user-1',
    reminderId: 'reminder-1',
    changeEventId: 'event-1',
    attempt: 0,
    tokens: [
      { deviceId: 'retry-device', fcmToken: 'retry-token' },
      { deviceId: 'stale-device', fcmToken: 'stale-token' },
      { deviceId: 'ok-device', fcmToken: 'ok-token' },
    ],
  });

  assert.equal(result.processed, 3);
  assert.equal(result.delivered, 1);
  assert.equal(result.retriesScheduled, 1);
  assert.equal(result.unregisteredRemoved, 1);
  assert.equal(scheduledRetries.length, 1);
  assert.equal(scheduledRetries[0].delayMs, 30_000);
  assert.equal(scheduledRetries[0].job.token.deviceId, 'retry-device');
  assert.deepEqual(deletedTokens, [{ userId: 'user-1', deviceId: 'stale-device' }]);
});
