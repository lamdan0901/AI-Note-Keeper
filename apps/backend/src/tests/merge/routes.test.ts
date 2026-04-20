import assert from 'node:assert/strict';
import type { Server } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createTokenFactory } from '../../auth/tokens.js';
import type { MergeService } from '../../merge/service.js';
import { createMergeRoutes } from '../../merge/routes.js';
import {
  AppError,
  errorMiddleware,
  notFoundMiddleware,
} from '../../middleware/error-middleware.js';

const createServiceDouble = (): MergeService => {
  return {
    preflight: async ({ fromUserId, toUserId }) => {
      return {
        summary: {
          sourceEmpty: false,
          sourceSampleOnly: false,
          targetEmpty: false,
          hasConflicts: fromUserId !== toUserId,
          sourceCounts: {
            notes: 2,
            subscriptions: 1,
            tokens: 1,
            events: 1,
          },
          targetCounts: {
            notes: 1,
            subscriptions: 0,
            tokens: 1,
            events: 0,
          },
        },
      };
    },

    apply: async ({ strategy, password, fromUserId, toUserId }) => {
      if (password === 'blocked') {
        throw new AppError({
          code: 'rate_limit',
          details: {
            retryAfterSeconds: 12,
            resetAt: 1_700_000_012_000,
            internalStack: 'should-not-leak',
          },
        });
      }

      return {
        strategy,
        resolution: strategy === 'both' ? 'prompt' : strategy,
        summary: {
          sourceEmpty: false,
          sourceSampleOnly: false,
          targetEmpty: false,
          hasConflicts: fromUserId !== toUserId,
          sourceCounts: {
            notes: 2,
            subscriptions: 1,
            tokens: 1,
            events: 1,
          },
          targetCounts: {
            notes: strategy === 'cloud' ? 1 : 2,
            subscriptions: 1,
            tokens: 1,
            events: 1,
          },
        },
      };
    },
  };
};

const startServer = async (
  service: MergeService,
): Promise<Readonly<{ baseUrl: string; close: () => Promise<void> }>> => {
  const app = express();
  app.use(express.json());
  app.use('/api/merge', createMergeRoutes(service));
  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

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
  const pair = await tokenFactory.issueTokenPair({
    userId,
    username: userId,
  });

  return pair.accessToken;
};

test('merge preflight returns parity summary fields and count objects', async () => {
  const server = await startServer(createServiceDouble());
  const token = await createAccessToken('source-user');

  try {
    const response = await fetch(`${server.baseUrl}/api/merge/preflight`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        toUserId: 'target-user',
        username: 'alice',
        password: 'correct-password',
      }),
    });

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      summary: {
        sourceEmpty: boolean;
        sourceSampleOnly: boolean;
        targetEmpty: boolean;
        hasConflicts: boolean;
        sourceCounts: Record<string, number>;
        targetCounts: Record<string, number>;
      };
    };

    assert.equal(typeof payload.summary.sourceEmpty, 'boolean');
    assert.equal(typeof payload.summary.sourceSampleOnly, 'boolean');
    assert.equal(typeof payload.summary.targetEmpty, 'boolean');
    assert.equal(typeof payload.summary.hasConflicts, 'boolean');
    assert.deepEqual(Object.keys(payload.summary.sourceCounts).sort(), [
      'events',
      'notes',
      'subscriptions',
      'tokens',
    ]);
    assert.deepEqual(Object.keys(payload.summary.targetCounts).sort(), [
      'events',
      'notes',
      'subscriptions',
      'tokens',
    ]);
  } finally {
    await server.close();
  }
});

test('merge apply accepts only cloud|local|both and returns deterministic summary', async () => {
  const server = await startServer(createServiceDouble());
  const token = await createAccessToken('source-user');

  try {
    const invalid = await fetch(`${server.baseUrl}/api/merge/apply`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        toUserId: 'target-user',
        username: 'alice',
        password: 'correct-password',
        strategy: 'hybrid',
      }),
    });

    assert.equal(invalid.status, 400);
    const invalidPayload = (await invalid.json()) as { code: string; status: number };
    assert.equal(invalidPayload.code, 'validation');

    const valid = await fetch(`${server.baseUrl}/api/merge/apply`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        toUserId: 'target-user',
        username: 'alice',
        password: 'correct-password',
        strategy: 'both',
      }),
    });

    assert.equal(valid.status, 200);
    const payload = (await valid.json()) as {
      strategy: string;
      resolution: string;
      summary: {
        sourceCounts: { notes: number };
        targetCounts: { notes: number };
      };
    };

    assert.equal(payload.strategy, 'both');
    assert.equal(payload.resolution, 'prompt');
    assert.equal(payload.summary.sourceCounts.notes, 2);
    assert.equal(payload.summary.targetCounts.notes, 2);
  } finally {
    await server.close();
  }
});

test('merge throttle rejection returns rate_limit with retryAfterSeconds and resetAt only', async () => {
  const server = await startServer(createServiceDouble());
  const token = await createAccessToken('source-user');

  try {
    const response = await fetch(`${server.baseUrl}/api/merge/apply`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        toUserId: 'target-user',
        username: 'alice',
        password: 'blocked',
        strategy: 'local',
      }),
    });

    assert.equal(response.status, 429);
    const payload = (await response.json()) as {
      code: string;
      status: number;
      details?: Record<string, unknown>;
    };

    assert.equal(payload.code, 'rate_limit');
    assert.equal(payload.status, 429);
    assert.equal(payload.details?.retryAfterSeconds, 12);
    assert.equal(payload.details?.resetAt, 1_700_000_012_000);
    assert.equal(
      Object.prototype.hasOwnProperty.call(payload.details ?? {}, 'internalStack'),
      false,
    );
  } finally {
    await server.close();
  }
});
