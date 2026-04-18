import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { createHealthStatus } from '../health.js';
import { evaluateReadiness, type QueryClient } from '../health/readiness.js';
import { createApp, runInitialStartupChecks } from '../index.js';

const createQueryClient = (responses: ReadonlyArray<{ rows: ReadonlyArray<Record<string, unknown>> }>): QueryClient => {
  const queue = [...responses];

  return {
    query: async () => {
      const next = queue.shift();

      if (!next) {
        throw new Error('No query response configured');
      }

      return next;
    },
  };
};

test('createHealthStatus returns a healthy backend payload', () => {
  assert.deepStrictEqual(createHealthStatus(), {
    ok: true,
    service: 'backend',
  });
});

test('evaluateReadiness returns healthy when DB and schema_migrations checks pass', async () => {
  const status = await evaluateReadiness({
    queryClient: createQueryClient([{ rows: [{ ok: 1 }] }, { rows: [{ present: true }] }]),
    dependencyDegraded: false,
  });

  assert.deepStrictEqual(status, {
    ok: true,
    service: 'backend',
    checks: {
      database: 'up',
      migrations: 'up',
    },
  });
});

test('evaluateReadiness reports migrations down when schema_migrations is missing', async () => {
  const status = await evaluateReadiness({
    queryClient: createQueryClient([{ rows: [{ ok: 1 }] }, { rows: [{ present: false }] }]),
    dependencyDegraded: false,
  });

  assert.deepStrictEqual(status, {
    ok: false,
    service: 'backend',
    checks: {
      database: 'up',
      migrations: 'down',
    },
  });
});

test('runInitialStartupChecks fails fast when readiness is unhealthy', async () => {
  await assert.rejects(
    () =>
      runInitialStartupChecks(async () => ({
        ok: false,
        service: 'backend',
        checks: {
          database: 'down',
          migrations: 'down',
        },
      })),
    /Initial readiness check failed/,
  );
});

test('degraded dependencies keep health endpoints online and fail API routes', async () => {
  let degraded = false;

  const app = createApp({
    isDependencyDegraded: () => degraded,
    readinessProbe: async () => ({
      ok: !degraded,
      service: 'backend',
      checks: {
        database: degraded ? 'down' : 'up',
        migrations: degraded ? 'down' : 'up',
      },
    }),
  });

  const server = await new Promise<import('node:net').Server>((resolve, reject) => {
    const running = app.listen(0, '127.0.0.1', () => resolve(running));
    running.once('error', reject);
  });

  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected socket address for test server');
    }

    const baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;

    const healthyApiResponse = await fetch(`${baseUrl}/api/sample`);
    assert.equal(healthyApiResponse.status, 200);

    degraded = true;

    const liveResponse = await fetch(`${baseUrl}/health/live`);
    const livePayload = (await liveResponse.json()) as Record<string, unknown>;
    assert.equal(liveResponse.status, 200);
    assert.deepStrictEqual(livePayload, {
      ok: true,
      service: 'backend',
    });

    const readyResponse = await fetch(`${baseUrl}/health/ready`);
    const readyPayload = (await readyResponse.json()) as Record<string, unknown>;
    assert.equal(readyResponse.status, 503);
    assert.equal(readyPayload.ok, false);

    const degradedApiResponse = await fetch(`${baseUrl}/api/sample`);
    const degradedApiPayload = (await degradedApiResponse.json()) as Record<string, unknown>;
    assert.equal(degradedApiResponse.status, 500);
    assert.deepStrictEqual(degradedApiPayload, {
      code: 'internal',
      message: 'Internal server error',
      status: 500,
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
});