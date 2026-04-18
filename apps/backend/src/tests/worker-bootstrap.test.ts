import assert from 'node:assert/strict';
import test from 'node:test';

import { createApiServer } from '../runtime/createApiServer.js';
import { createPgBossAdapter } from '../worker/boss-adapter.js';
import { startWorker } from '../worker/index.js';

test('worker boot initializes and shuts down adapter through contract methods', async () => {
  let started = false;
  let stopped = false;

  const adapter = {
    name: 'fake-adapter',
    start: async () => {
      started = true;
    },
    stop: async () => {
      stopped = true;
    },
    health: async () => ({
      status: 'running' as const,
    }),
  };

  const worker = await startWorker({
    adapter,
    installSignalHandlers: false,
    logger: {
      info: (_message: string) => {
        // no-op
      },
      error: (_message: string, _error?: unknown) => {
        // no-op
      },
    },
  });

  assert.equal(started, true);
  assert.equal(worker.adapterName, 'fake-adapter');

  await worker.shutdown();
  assert.equal(stopped, true);
});

test('pg-boss adapter scaffold exposes deterministic lifecycle signatures', async () => {
  const adapter = createPgBossAdapter({
    logger: {
      info: (_message: string) => {
        // no-op
      },
      error: (_message: string, _error?: unknown) => {
        // no-op
      },
    },
  });

  assert.equal(adapter.name, 'pg-boss-adapter');
  assert.equal(typeof adapter.start, 'function');
  assert.equal(typeof adapter.stop, 'function');
  assert.equal(typeof adapter.health, 'function');

  await adapter.start();
  const runningHealth = await adapter.health();
  assert.equal(runningHealth.status, 'running');

  await adapter.stop();
  const stoppedHealth = await adapter.health();
  assert.equal(stoppedHealth.status, 'stopped');
});

test('API and worker runtime scaffolds can be initialized independently', async () => {
  const api = createApiServer({
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

  assert.equal(typeof api.listen, 'function');

  const worker = await startWorker({
    installSignalHandlers: false,
    logger: {
      info: (_message: string) => {
        // no-op
      },
      error: (_message: string, _error?: unknown) => {
        // no-op
      },
    },
  });

  assert.equal(worker.adapterName, 'pg-boss-adapter');
  await worker.shutdown();
});
