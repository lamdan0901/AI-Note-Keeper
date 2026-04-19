import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Server } from 'node:net';
import test from 'node:test';

import { createTokenFactory } from '../../auth/tokens.js';
import { createApiServer } from '../../runtime/createApiServer.js';

const startServer = async () => {
  const app = createApiServer({
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

const expectAuthEnvelope = async (response: Response) => {
  const payload = (await response.json()) as { code: string; message: string; status: number };
  assert.equal(response.status, 401);
  assert.deepEqual(Object.keys(payload).sort(), ['code', 'message', 'status']);
  assert.equal(payload.code, 'auth');
  assert.equal(payload.status, 401);
};

const createAccessToken = async (userId: string): Promise<string> => {
  const tokenFactory = createTokenFactory();
  const pair = await tokenFactory.issueTokenPair({
    userId,
    username: userId,
  });

  return pair.accessToken;
};

test('unauthorized requests across phase-3 routes return auth error contract', async () => {
  const server = await startServer();

  try {
    await expectAuthEnvelope(await fetch(`${server.baseUrl}/api/notes`));
    await expectAuthEnvelope(await fetch(`${server.baseUrl}/api/subscriptions`));
    await expectAuthEnvelope(
      await fetch(`${server.baseUrl}/api/device-tokens`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId: 'd', fcmToken: 'f', platform: 'android' }),
      }),
    );
    await expectAuthEnvelope(
      await fetch(`${server.baseUrl}/api/ai/parse-voice`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          transcript: 'hello',
          userId: 'u',
          timezone: 'UTC',
          nowEpochMs: 1_700_000_000_000,
          locale: 'en-US',
          sessionId: 'session-1',
        }),
      }),
    );
  } finally {
    await server.close();
  }
});

test('malformed phase-3 payloads return validation contract with issue details', async () => {
  const server = await startServer();
  const token = await createAccessToken('user-1');

  try {
    const parseInvalid = await fetch(`${server.baseUrl}/api/ai/parse-voice`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ transcript: '' }),
    });

    assert.equal(parseInvalid.status, 400);
    const parsePayload = (await parseInvalid.json()) as {
      code: string;
      status: number;
      details?: { issues?: ReadonlyArray<unknown> };
    };
    assert.equal(parsePayload.code, 'validation');
    assert.equal(parsePayload.status, 400);
    assert.ok((parsePayload.details?.issues?.length ?? 0) > 0);

    const subscriptionsInvalid = await fetch(`${server.baseUrl}/api/subscriptions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ serviceName: '' }),
    });

    assert.equal(subscriptionsInvalid.status, 400);
    const subscriptionsPayload = (await subscriptionsInvalid.json()) as {
      code: string;
      status: number;
      details?: { issues?: ReadonlyArray<unknown> };
    };
    assert.equal(subscriptionsPayload.code, 'validation');
    assert.equal(subscriptionsPayload.status, 400);
    assert.ok((subscriptionsPayload.details?.issues?.length ?? 0) > 0);
  } finally {
    await server.close();
  }
});

test('notification_ledger remains absent from mounted backend route surfaces', async () => {
  const runtimeSource = await readFile(new URL('../../runtime/createApiServer.js', import.meta.url), 'utf8');
  const deviceRoutesSource = await readFile(new URL('../../device-tokens/routes.js', import.meta.url), 'utf8');

  assert.equal(runtimeSource.includes('notification_ledger'), false);
  assert.equal(runtimeSource.includes('notification-ledger'), false);
  assert.equal(deviceRoutesSource.includes('notification_ledger'), false);
  assert.equal(deviceRoutesSource.includes('notification-ledger'), false);

  const server = await startServer();
  try {
    const response = await fetch(`${server.baseUrl}/api/notification-ledger`);
    const payload = (await response.json()) as { code: string; status: number };

    assert.equal(response.status, 404);
    assert.equal(payload.code, 'not_found');
    assert.equal(payload.status, 404);
  } finally {
    await server.close();
  }
});
