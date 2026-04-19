import assert from 'node:assert/strict';
import type { Server } from 'node:net';
import test from 'node:test';

import { createApiServer } from '../../runtime/createApiServer.js';
import { startWorker } from '../../worker/index.js';

process.env.DATABASE_URL ??= 'postgres://localhost:5432/ai-note-keeper-test';

const startApi = async (isDependencyDegraded: () => boolean): Promise<Readonly<{
  baseUrl: string;
  close: () => Promise<void>;
}>> => {
  const app = createApiServer({
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