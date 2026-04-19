import assert from 'node:assert/strict';
import type { Server } from 'node:net';
import test from 'node:test';

import type { AuthService } from '../../auth/service.js';
import type { AiRateLimiter } from '../../ai/rate-limit.js';
import type { AiService } from '../../ai/service.js';
import type { DeviceTokensService } from '../../device-tokens/service.js';
import type { MergeApplyInput, MergePreflightInput, MergeResolution } from '../../merge/contracts.js';
import { AppError } from '../../middleware/error-middleware.js';
import type { NotesService } from '../../notes/service.js';
import type { RemindersService } from '../../reminders/service.js';
import type { SubscriptionsService } from '../../subscriptions/service.js';

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

type SecurityState = {
  failedAttemptsByTarget: Map<string, number>;
  applyInFlightTargets: Set<string>;
  targetNotesByUser: Map<string, number>;
};

const createSecurityMergeService = (state: SecurityState) => {
  const toSummary = (toUserId: string) => ({
    sourceEmpty: false,
    sourceSampleOnly: false,
    targetEmpty: false,
    hasConflicts: true,
    sourceCounts: {
      notes: 3,
      subscriptions: 1,
      tokens: 1,
      events: 1,
    },
    targetCounts: {
      notes: state.targetNotesByUser.get(toUserId) ?? 1,
      subscriptions: 1,
      tokens: 1,
      events: 1,
    },
  });

  const bumpFailedAttempt = (toUserId: string): number => {
    const next = (state.failedAttemptsByTarget.get(toUserId) ?? 0) + 1;
    state.failedAttemptsByTarget.set(toUserId, next);
    return next;
  };

  const resetFailedAttempts = (toUserId: string): void => {
    state.failedAttemptsByTarget.set(toUserId, 0);
  };

  const authorize = (input: MergePreflightInput): void => {
    if (input.password === 'correct-password') {
      resetFailedAttempts(input.toUserId);
      return;
    }

    const attempts = bumpFailedAttempt(input.toUserId);
    if (attempts >= 3) {
      throw new AppError({
        code: 'rate_limit',
        details: {
          retryAfterSeconds: 60,
          resetAt: 1_800_000_000_000,
          debugStack: 'omit-me',
        },
      });
    }

    throw new AppError({ code: 'auth' });
  };

  return {
    preflight: async (input: MergePreflightInput) => {
      authorize(input);
      return {
        summary: toSummary(input.toUserId),
      };
    },

    apply: async (input: MergeApplyInput) => {
      authorize(input);

      if (state.applyInFlightTargets.has(input.toUserId)) {
        throw new AppError({ code: 'conflict', message: 'Merge already in progress' });
      }

      state.applyInFlightTargets.add(input.toUserId);

      try {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 20);
        });

        const currentNotes = state.targetNotesByUser.get(input.toUserId) ?? 1;
        state.targetNotesByUser.set(input.toUserId, currentNotes + 1);
        const resolution: MergeResolution = input.strategy === 'both' ? 'prompt' : input.strategy;

        return {
          strategy: input.strategy,
          resolution,
          summary: toSummary(input.toUserId),
        };
      } finally {
        state.applyInFlightTargets.delete(input.toUserId);
      }
    },
  };
};

const startServer = async (state: SecurityState) => {
  const app = createApiServer({
    authService: createAuthServiceDouble(),
    notesService: createNoopNotesService(),
    remindersService: createNoopRemindersService(),
    subscriptionsService: createNoopSubscriptionsService(),
    deviceTokensService: createNoopDeviceTokensService(),
    mergeService: createSecurityMergeService(state),
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

const assertEnvelopeShape = (payload: { code?: unknown; message?: unknown; status?: unknown }): void => {
  assert.equal(typeof payload.code, 'string');
  assert.equal(typeof payload.message, 'string');
  assert.equal(typeof payload.status, 'number');
};

test('phase-5 security: repeated merge abuse attempts trigger rate_limit with retry metadata', async () => {
  const state: SecurityState = {
    failedAttemptsByTarget: new Map(),
    applyInFlightTargets: new Set(),
    targetNotesByUser: new Map(),
  };
  const server = await startServer(state);
  const token = await createAccessToken('source-user');

  try {
    const attempt = async (): Promise<Response> => {
      return await fetch(`${server.baseUrl}/api/merge/apply`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          toUserId: 'target-user',
          username: 'target-username',
          password: 'wrong-password',
          strategy: 'local',
        }),
      });
    };

    const first = await attempt();
    const second = await attempt();
    const third = await attempt();
    const fourth = await attempt();

    assert.equal(first.status, 401);
    assert.equal(second.status, 401);
    assert.equal(third.status, 429);
    assert.equal(fourth.status, 429);

    const payload = (await third.json()) as {
      code: string;
      status: number;
      details?: Record<string, unknown>;
    };

    assert.equal(payload.code, 'rate_limit');
    assert.equal(payload.status, 429);
    assert.equal(payload.details?.retryAfterSeconds, 60);
    assert.equal(payload.details?.resetAt, 1_800_000_000_000);
    assert.equal(Object.prototype.hasOwnProperty.call(payload.details ?? {}, 'debugStack'), false);
  } finally {
    await server.close();
  }
});

test('phase-5 security: concurrent merge apply attempts do not double-write target state', async () => {
  const state: SecurityState = {
    failedAttemptsByTarget: new Map(),
    applyInFlightTargets: new Set(),
    targetNotesByUser: new Map([['target-user', 1]]),
  };
  const server = await startServer(state);
  const token = await createAccessToken('source-user');

  try {
    const runApply = async (): Promise<Response> => {
      return await fetch(`${server.baseUrl}/api/merge/apply`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          toUserId: 'target-user',
          username: 'target-username',
          password: 'correct-password',
          strategy: 'both',
        }),
      });
    };

    const [left, right] = await Promise.all([runApply(), runApply()]);
    const statuses = [left.status, right.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [200, 409]);

    const postPreflight = await fetch(`${server.baseUrl}/api/merge/preflight`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        toUserId: 'target-user',
        username: 'target-username',
        password: 'correct-password',
      }),
    });

    assert.equal(postPreflight.status, 200);
    const summary = (await postPreflight.json()) as {
      summary: { targetCounts: { notes: number } };
    };

    assert.equal(summary.summary.targetCounts.notes, 2);
  } finally {
    await server.close();
  }
});

test('phase-5 security: unauthorized and malformed requests preserve stable non-2xx envelope shape', async () => {
  const state: SecurityState = {
    failedAttemptsByTarget: new Map(),
    applyInFlightTargets: new Set(),
    targetNotesByUser: new Map(),
  };
  const server = await startServer(state);
  const token = await createAccessToken('source-user');

  try {
    const unauthorized = await fetch(`${server.baseUrl}/api/merge/preflight`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        toUserId: 'target-user',
        username: 'target-username',
        password: 'correct-password',
      }),
    });

    assert.equal(unauthorized.status, 401);
    const unauthorizedPayload = (await unauthorized.json()) as {
      code: string;
      message: string;
      status: number;
    };
    assertEnvelopeShape(unauthorizedPayload);
    assert.equal(unauthorizedPayload.code, 'auth');

    const malformed = await fetch(`${server.baseUrl}/api/merge/apply`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        toUserId: '',
        username: 'target-username',
        password: 'correct-password',
        strategy: 'hybrid',
      }),
    });

    assert.equal(malformed.status, 400);
    const malformedPayload = (await malformed.json()) as {
      code: string;
      message: string;
      status: number;
      details?: { issues?: ReadonlyArray<unknown> };
    };
    assertEnvelopeShape(malformedPayload);
    assert.equal(malformedPayload.code, 'validation');
    assert.ok((malformedPayload.details?.issues?.length ?? 0) > 0);
  } finally {
    await server.close();
  }
});