import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Server } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createTokenFactory } from '../../auth/tokens.js';
import type { DeviceTokenRecord } from '../../device-tokens/contracts.js';
import { createDeviceTokensRoutes } from '../../device-tokens/routes.js';
import type { DeviceTokensService } from '../../device-tokens/service.js';
import { errorMiddleware, notFoundMiddleware } from '../../middleware/error-middleware.js';

const createServiceDouble = (): DeviceTokensService &
  Readonly<{ tokens: Map<string, DeviceTokenRecord> }> => {
  const tokens = new Map<string, DeviceTokenRecord>();

  return {
    tokens,
    upsert: async ({ userId, deviceId, fcmToken, platform }) => {
      if (platform !== 'android') {
        throw new Error('Only android platform is supported for device tokens');
      }

      const existing = tokens.get(deviceId);

      const now = new Date();
      const record: DeviceTokenRecord = {
        id: existing?.id ?? `${userId}:${deviceId}`,
        userId,
        deviceId,
        fcmToken,
        platform: 'android',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      tokens.set(deviceId, record);
      return record;
    },

    deleteByDeviceId: async ({ userId, deviceId }) => {
      const existing = tokens.get(deviceId);
      if (!existing) {
        return false;
      }

      if (existing.userId !== userId) {
        const error = new Error('Device token does not belong to authenticated user');
        (error as unknown as { code: string }).code = 'forbidden';
        (error as unknown as { status: number }).status = 403;
        throw error;
      }

      tokens.delete(deviceId);
      return true;
    },
  };
};

const startServer = async (
  service: DeviceTokensService,
): Promise<Readonly<{ baseUrl: string; close: () => Promise<void> }>> => {
  const app = express();
  app.use(express.json());
  app.use('/api/device-tokens', createDeviceTokensRoutes(service));
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

test('device token route upsert is idempotent, allows same-device reassignment, and delete missing token is no-op', async () => {
  const service = createServiceDouble();
  const server = await startServer(service);
  const token = await createAccessToken('user-1');

  try {
    const first = await fetch(`${server.baseUrl}/api/device-tokens`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        deviceId: 'device-1',
        fcmToken: 'fcm-1',
        platform: 'android',
      }),
    });

    assert.equal(first.status, 200);
    assert.equal(service.tokens.size, 1);

    const second = await fetch(`${server.baseUrl}/api/device-tokens`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        deviceId: 'device-1',
        fcmToken: 'fcm-2',
        platform: 'android',
      }),
    });

    assert.equal(second.status, 200);
    assert.equal(service.tokens.size, 1);
    assert.equal(service.tokens.get('device-1')?.fcmToken, 'fcm-2');
    assert.equal(service.tokens.get('device-1')?.userId, 'user-1');

    const otherUserToken = await createAccessToken('user-2');
    const reassigned = await fetch(`${server.baseUrl}/api/device-tokens`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${otherUserToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        deviceId: 'device-1',
        fcmToken: 'fcm-3',
        platform: 'android',
      }),
    });

    assert.equal(reassigned.status, 200);
    assert.equal(service.tokens.size, 1);
    assert.equal(service.tokens.get('device-1')?.fcmToken, 'fcm-3');
    assert.equal(service.tokens.get('device-1')?.userId, 'user-2');

    const deletedMissing = await fetch(`${server.baseUrl}/api/device-tokens/missing-device`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    assert.equal(deletedMissing.status, 200);
    assert.deepEqual(await deletedMissing.json(), { deleted: false });
  } finally {
    await server.close();
  }
});

test('device token route rejects invalid platform payloads', async () => {
  const service = createServiceDouble();
  const server = await startServer(service);
  const token = await createAccessToken('user-1');

  try {
    const invalid = await fetch(`${server.baseUrl}/api/device-tokens`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        deviceId: 'device-1',
        fcmToken: 'fcm-1',
        platform: 'ios',
      }),
    });

    assert.equal(invalid.status, 400);
    const payload = (await invalid.json()) as { code: string; status: number };
    assert.equal(payload.code, 'validation');
    assert.equal(payload.status, 400);
  } finally {
    await server.close();
  }
});

test('notification_ledger remains excluded from backend routes and repositories', async () => {
  const routesSource = await readFile(
    new URL('../../device-tokens/routes.js', import.meta.url),
    'utf8',
  );
  const repoSource = await readFile(
    new URL('../../device-tokens/repositories/device-tokens-repository.js', import.meta.url),
    'utf8',
  );

  assert.equal(routesSource.includes('notification-ledger'), false);
  assert.equal(routesSource.includes('notification_ledger'), false);
  assert.equal(repoSource.includes('notification_ledger'), false);
});
