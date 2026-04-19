import assert from 'node:assert/strict';
import type { Server } from 'node:net';
import test from 'node:test';

import type { AuthService } from '../../auth/service.js';
import { createTokenFactory } from '../../auth/tokens.js';
import type { AiService } from '../../ai/service.js';
import { createAiRateLimiter } from '../../ai/rate-limit.js';
import type { DeviceTokensService } from '../../device-tokens/service.js';
import { AppError } from '../../middleware/error-middleware.js';
import type { NotesService } from '../../notes/service.js';
import { createApiServer } from '../../runtime/createApiServer.js';
import type { SubscriptionsService } from '../../subscriptions/service.js';

const createAuthServiceDouble = (): AuthService => ({
  register: async (input) => ({
    userId: 'u-register',
    username: input.username,
    tokens: {
      accessToken: 'access-register',
      refreshToken: 'refresh-register',
      accessExpiresAt: Date.now() + 60_000,
      refreshExpiresAt: Date.now() + 120_000,
    },
  }),
  login: async (input) => ({
    userId: 'u-login',
    username: input.username,
    tokens: {
      accessToken: 'access-login',
      refreshToken: 'refresh-login',
      accessExpiresAt: Date.now() + 60_000,
      refreshExpiresAt: Date.now() + 120_000,
    },
  }),
  refresh: async () => ({
    userId: 'u-refresh',
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

const createPhase3Doubles = () => {
  let noteMutationCount = 0;
  const noteReplayKeys = new Set<string>();

  const notesService = {
    listNotes: async () => [],
    sync: async (input: { userId: string; lastSyncAt: number; changes: ReadonlyArray<{ id: string; operation: string; payloadHash: string }> }) => {
      for (const change of input.changes) {
        const key = `${input.userId}:${change.id}:${change.operation}:${change.payloadHash}`;
        if (noteReplayKeys.has(key)) {
          continue;
        }

        noteReplayKeys.add(key);
        noteMutationCount += 1;
      }

      return { notes: [], syncedAt: input.lastSyncAt + 1 };
    },
    restoreNote: async () => true,
    trashNote: async () => true,
    permanentlyDeleteNote: async () => true,
    emptyTrash: async () => 0,
    purgeExpiredTrash: async () => 0,
  };

  const subscriptionsByUser = new Map<string, Map<string, Record<string, unknown>>>();
  const getSubscriptionMap = (userId: string): Map<string, Record<string, unknown>> => {
    const existing = subscriptionsByUser.get(userId);
    if (existing) {
      return existing;
    }

    const created = new Map<string, Record<string, unknown>>();
    subscriptionsByUser.set(userId, created);
    return created;
  };

  const subscriptionsService = {
    list: async ({ userId }: { userId: string }) => [...getSubscriptionMap(userId).values()],
    create: async (input: {
      userId: string;
      serviceName: string;
      category: string;
      price: number;
      currency: string;
      billingCycle: string;
      billingCycleCustomDays: number | null;
      nextBillingDate: Date;
      notes: string | null;
      trialEndDate: Date | null;
      status: string;
      reminderDaysBefore: ReadonlyArray<number>;
    }) => {
      const id = `sub-${getSubscriptionMap(input.userId).size + 1}`;
      const created = {
        id,
        userId: input.userId,
        serviceName: input.serviceName,
        category: input.category,
        price: input.price,
        currency: input.currency,
        billingCycle: input.billingCycle,
        billingCycleCustomDays: input.billingCycleCustomDays,
        nextBillingDate: input.nextBillingDate,
        notes: input.notes,
        trialEndDate: input.trialEndDate,
        status: input.status,
        reminderDaysBefore: [...input.reminderDaysBefore],
        nextReminderAt: null,
        lastNotifiedBillingDate: null,
        nextTrialReminderAt: null,
        lastNotifiedTrialEndDate: null,
        active: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      getSubscriptionMap(input.userId).set(id, created);
      return created;
    },
    update: async ({ subscriptionId, userId, patch }: { subscriptionId: string; userId: string; patch: Record<string, unknown> }) => {
      const current = getSubscriptionMap(userId).get(subscriptionId);
      if (!current) {
        throw new AppError({ code: 'not_found', message: 'Subscription not found' });
      }

      const updated = { ...current, ...patch, updatedAt: new Date() };
      getSubscriptionMap(userId).set(subscriptionId, updated);
      return updated;
    },
    trash: async () => true,
    restore: async () => true,
    permanentlyDelete: async () => true,
    purgeExpiredTrash: async () => 0,
  };

  const deviceTokens = new Map<string, { userId: string; token: Record<string, unknown> }>();

  const deviceTokensService = {
    upsert: async (input: { userId: string; deviceId: string; fcmToken: string; platform: 'android' }) => {
      const existing = deviceTokens.get(input.deviceId);
      if (existing && existing.userId !== input.userId) {
        throw new AppError({
          code: 'forbidden',
          message: 'Device token does not belong to authenticated user',
        });
      }

      const token = {
        id: `${input.userId}:${input.deviceId}`,
        userId: input.userId,
        deviceId: input.deviceId,
        fcmToken: input.fcmToken,
        platform: input.platform,
        updatedAt: new Date(),
        createdAt: existing?.token.createdAt ?? new Date(),
      };
      deviceTokens.set(input.deviceId, { userId: input.userId, token });
      return token;
    },
    deleteByDeviceId: async ({ userId, deviceId }: { userId: string; deviceId: string }) => {
      const existing = deviceTokens.get(deviceId);
      if (!existing) {
        return false;
      }

      if (existing.userId !== userId) {
        throw new AppError({
          code: 'forbidden',
          message: 'Device token does not belong to authenticated user',
        });
      }

      deviceTokens.delete(deviceId);
      return true;
    },
  };

  const aiService = {
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
        title: 0,
        content: 0,
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
  };

  return {
    notesService,
    subscriptionsService,
    deviceTokensService,
    aiService,
    getNoteMutationCount: () => noteMutationCount,
  };
};

const startServer = async () => {
  const doubles = createPhase3Doubles();
  const app = createApiServer({
    authService: createAuthServiceDouble(),
    notesService: doubles.notesService as unknown as NotesService,
    subscriptionsService: doubles.subscriptionsService as unknown as SubscriptionsService,
    deviceTokensService: doubles.deviceTokensService as unknown as DeviceTokensService,
    aiService: doubles.aiService as unknown as AiService,
    aiRateLimiter: createAiRateLimiter({ parseLimit: 1, clarifyLimit: 10, windowMs: 60_000 }, () => 1_700_000_000_000),
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
    throw new Error('Expected address info from test server');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    doubles,
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

test('phase-3 route trees are mounted under /api and auth route behavior remains available', async () => {
  const server = await startServer();
  const token = await createAccessToken('user-1');

  try {
    const authResponse = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-client-platform': 'mobile',
      },
      body: JSON.stringify({ username: 'alice', password: 'password-123' }),
    });
    assert.equal(authResponse.status, 200);

    const notesResponse = await fetch(`${server.baseUrl}/api/notes`, {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    assert.equal(notesResponse.status, 200);

    const subscriptionsResponse = await fetch(`${server.baseUrl}/api/subscriptions`, {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    assert.equal(subscriptionsResponse.status, 200);

    const deviceResponse = await fetch(`${server.baseUrl}/api/device-tokens/missing-device`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    assert.equal(deviceResponse.status, 200);

    const aiResponse = await fetch(`${server.baseUrl}/api/ai/parse-voice`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        transcript: 'draft this quick note',
        userId: 'user-1',
        timezone: 'UTC',
        nowEpochMs: 1_700_000_000_000,
        locale: 'en-US',
        sessionId: 'session-1',
      }),
    });
    assert.equal(aiResponse.status, 200);
  } finally {
    await server.close();
  }
});

test('notes sync replay with same payloadHash is idempotent over HTTP', async () => {
  const server = await startServer();
  const token = await createAccessToken('user-1');

  try {
    const body = {
      lastSyncAt: 1_700_000_000_000,
      changes: [
        {
          id: 'note-1',
          userId: 'ignored-client-user',
          operation: 'update',
          payloadHash: 'hash-1',
          deviceId: 'device-1',
          updatedAt: 1_700_000_000_100,
          title: 'Title',
        },
      ],
    };

    const first = await fetch(`${server.baseUrl}/api/notes/sync`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const second = await fetch(`${server.baseUrl}/api/notes/sync`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(server.doubles.getNoteMutationCount(), 1);
  } finally {
    await server.close();
  }
});

test('subscriptions and device-token mutations reject cross-user ownership violations', async () => {
  const server = await startServer();
  const ownerToken = await createAccessToken('owner-user');
  const otherToken = await createAccessToken('other-user');

  try {
    const createSubscription = await fetch(`${server.baseUrl}/api/subscriptions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ownerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        serviceName: 'Prime',
        category: 'streaming',
        price: 15,
        currency: 'USD',
        billingCycle: 'monthly',
        billingCycleCustomDays: null,
        nextBillingDate: 1_700_864_000_000,
        notes: null,
        trialEndDate: null,
        status: 'active',
        reminderDaysBefore: [2],
      }),
    });

    assert.equal(createSubscription.status, 201);
    const createdPayload = (await createSubscription.json()) as { subscription: { id: string } };

    const crossUserPatch = await fetch(
      `${server.baseUrl}/api/subscriptions/${createdPayload.subscription.id}`,
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${otherToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ price: 99 }),
      },
    );

    assert.equal(crossUserPatch.status, 404);
    const patchPayload = (await crossUserPatch.json()) as { code: string; message: string; status: number };
    assert.deepEqual(Object.keys(patchPayload).sort(), ['code', 'message', 'status']);
    assert.equal(patchPayload.code, 'not_found');
    assert.equal(patchPayload.status, 404);

    const ownerUpsert = await fetch(`${server.baseUrl}/api/device-tokens`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ownerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        deviceId: 'shared-device',
        fcmToken: 'owner-token',
        platform: 'android',
      }),
    });

    assert.equal(ownerUpsert.status, 200);

    const crossUserDelete = await fetch(`${server.baseUrl}/api/device-tokens/shared-device`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${otherToken}`,
      },
    });

    assert.equal(crossUserDelete.status, 403);
    const devicePayload = (await crossUserDelete.json()) as { code: string; message: string; status: number };
    assert.deepEqual(Object.keys(devicePayload).sort(), ['code', 'message', 'status']);
    assert.equal(devicePayload.code, 'forbidden');
    assert.equal(devicePayload.status, 403);
  } finally {
    await server.close();
  }
});

test('AI parse returns deterministic fallback response and enforces rate-limit contract', async () => {
  const server = await startServer();
  const token = await createAccessToken('user-1');

  try {
    const body = {
      transcript: 'capture this text',
      userId: 'user-1',
      timezone: 'UTC',
      nowEpochMs: 1_700_000_000_000,
      locale: 'en-US',
      sessionId: 'session-1',
    };

    const first = await fetch(`${server.baseUrl}/api/ai/parse-voice`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    assert.equal(first.status, 200);
    const firstPayload = (await first.json()) as {
      draft: { keepTranscriptInContent: boolean; normalizedTranscript: string };
      clarification: { required: boolean };
    };

    assert.equal(firstPayload.draft.keepTranscriptInContent, true);
    assert.equal(firstPayload.draft.normalizedTranscript, 'capture this text');
    assert.equal(firstPayload.clarification.required, false);

    const second = await fetch(`${server.baseUrl}/api/ai/parse-voice`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    assert.equal(second.status, 429);
    const secondPayload = (await second.json()) as {
      code: string;
      message: string;
      status: number;
      details?: { retryAfterSeconds?: number; resetAt?: number };
    };

    assert.equal(secondPayload.code, 'rate_limit');
    assert.equal(secondPayload.status, 429);
    assert.equal(typeof secondPayload.message, 'string');
    assert.ok((secondPayload.details?.retryAfterSeconds ?? 0) >= 1);
  } finally {
    await server.close();
  }
});
