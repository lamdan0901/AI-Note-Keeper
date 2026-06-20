import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { promisify } from 'node:util';

import { createApiServer } from '../runtime/createApiServer.js';
import { createInFlightPushJobTracker, createPgBossAdapter } from '../worker/boss-adapter.js';
import { startWorker } from '../worker/index.js';

process.env.DATABASE_URL ??= 'postgres://localhost:5432/ai-note-keeper-test';

const execFileAsync = promisify(execFile);

const createNoopDispatchResult = (now: Date) => ({
  cronKey: 'check-reminders',
  since: now,
  now,
  scanned: 0,
  enqueued: 0,
  duplicates: 0,
});

const createNoopSubscriptionDispatchJob = () => ({
  run: async () => {
    const now = new Date('2026-06-13T10:03:22.000Z');
    return createNoopDispatchResult(now);
  },
});

const withQstashSchedulerEnv = async (run: () => Promise<void>): Promise<void> => {
  const originalProvider = process.env.REMINDER_SCHEDULER_PROVIDER;
  const originalCallbackBaseUrl = process.env.REMINDER_SCHEDULER_CALLBACK_BASE_URL;
  const originalToken = process.env.QSTASH_TOKEN;
  const originalCurrentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const originalNextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;

  process.env.REMINDER_SCHEDULER_PROVIDER = 'qstash';
  process.env.REMINDER_SCHEDULER_CALLBACK_BASE_URL = 'https://api.example.test';
  process.env.QSTASH_TOKEN = 'qstash-token';
  process.env.QSTASH_CURRENT_SIGNING_KEY = 'current-signing-key';
  process.env.QSTASH_NEXT_SIGNING_KEY = 'next-signing-key';

  try {
    await run();
  } finally {
    if (originalProvider === undefined) {
      delete process.env.REMINDER_SCHEDULER_PROVIDER;
    } else {
      process.env.REMINDER_SCHEDULER_PROVIDER = originalProvider;
    }
    if (originalCallbackBaseUrl === undefined) {
      delete process.env.REMINDER_SCHEDULER_CALLBACK_BASE_URL;
    } else {
      process.env.REMINDER_SCHEDULER_CALLBACK_BASE_URL = originalCallbackBaseUrl;
    }
    if (originalToken === undefined) {
      delete process.env.QSTASH_TOKEN;
    } else {
      process.env.QSTASH_TOKEN = originalToken;
    }
    if (originalCurrentSigningKey === undefined) {
      delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    } else {
      process.env.QSTASH_CURRENT_SIGNING_KEY = originalCurrentSigningKey;
    }
    if (originalNextSigningKey === undefined) {
      delete process.env.QSTASH_NEXT_SIGNING_KEY;
    } else {
      process.env.QSTASH_NEXT_SIGNING_KEY = originalNextSigningKey;
    }
  }
};

const waitFor = async (
  predicate: () => boolean,
  timeoutMs: number,
  intervalMs: number = 10,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
};

test('push in-flight tracker waits for all tracked retry promises', async () => {
  const tracker = createInFlightPushJobTracker();

  const createDeferred = (): Readonly<{ promise: Promise<void>; resolve: () => void }> => {
    let resolve: () => void = () => {};
    const promise = new Promise<void>((nextResolve) => {
      resolve = nextResolve;
    });

    return {
      promise,
      resolve,
    };
  };

  const first = createDeferred();
  const second = createDeferred();

  tracker.track(first.promise);
  tracker.track(second.promise);

  assert.equal(tracker.hasInFlight(), true);

  const waiting = tracker.waitForAll();

  first.resolve();
  await Promise.resolve();
  assert.equal(tracker.hasInFlight(), true);

  second.resolve();
  await waiting;
  assert.equal(tracker.hasInFlight(), false);
});

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
    dispatchJob: {
      run: async () => createNoopDispatchResult(new Date('2026-06-13T10:03:22.000Z')),
    },
    reminderRepairJob: {
      run: async () => ({ candidates: 0, executed: 0, scheduled: 0 }),
    },
    subscriptionDispatchJob: createNoopSubscriptionDispatchJob(),
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

test('pg-boss adapter aligns recurring reminder repair to exact interval boundaries', async () => {
  let nowMs = Date.parse('2026-04-20T10:03:22.345Z');
  const timeoutQueue: Array<
    Readonly<{ handle: NodeJS.Timeout; delayMs: number; callback: () => void; cleared: boolean }>
  > = [];

  const scheduler = {
    setInterval: (_callback: () => void, _ms: number): NodeJS.Timeout => {
      throw new Error('setInterval should not be used for reminder repair scheduling');
    },
    clearInterval: (_handle: NodeJS.Timeout): void => {
      // no-op
    },
    setTimeout: (callback: () => void, ms: number): NodeJS.Timeout => {
      const handle = { id: timeoutQueue.length + 1 } as unknown as NodeJS.Timeout;
      timeoutQueue.push({
        handle,
        delayMs: ms,
        callback,
        cleared: false,
      });
      return handle;
    },
    clearTimeout: (handle: NodeJS.Timeout): void => {
      for (let index = 0; index < timeoutQueue.length; index += 1) {
        if (timeoutQueue[index].handle === handle) {
          timeoutQueue[index] = {
            ...timeoutQueue[index],
            cleared: true,
          };
        }
      }
    },
  };

  const repairRuns: string[] = [];
  await withQstashSchedulerEnv(async () => {
    const adapter = createPgBossAdapter({
      scheduler,
      now: () => new Date(nowMs),
      reminderRepairIntervalMs: 60_000,
      reminderRepairJob: {
        run: async () => {
          const runNow = new Date(nowMs);
          repairRuns.push(runNow.toISOString());
          return { candidates: 0, executed: 0, scheduled: 0 };
        },
      },
      subscriptionDispatchJob: createNoopSubscriptionDispatchJob(),
      logger: {
        info: (_message: string) => {
          // no-op
        },
        error: (_message: string, _error?: unknown) => {
          // no-op
        },
      },
    });

    const runNextTimeout = async (): Promise<void> => {
      const nextTimeout = timeoutQueue.reduce<Readonly<{
        index: number;
        item: (typeof timeoutQueue)[number];
      }> | null>((best, item, index) => {
        if (item.cleared) {
          return best;
        }

        if (best === null || item.delayMs < best.item.delayMs) {
          return { index, item };
        }

        return best;
      }, null);

      assert.ok(nextTimeout);
      const next = nextTimeout.item;
      timeoutQueue[nextTimeout.index] = {
        ...next,
        cleared: true,
      };

      nowMs += next.delayMs;
      next.callback();
      await Promise.resolve();
      await Promise.resolve();
    };

    await adapter.start();

    assert.equal(repairRuns.length, 1);
    assert.equal(repairRuns[0], '2026-04-20T10:03:22.345Z');
    assert.equal(
      timeoutQueue.some((item) => item.delayMs === 37_655),
      true,
    );

    await runNextTimeout();
    assert.equal(repairRuns[1], '2026-04-20T10:04:00.000Z');
    assert.equal(timeoutQueue.filter((item) => item.delayMs === 60_000).length >= 1, true);

    await runNextTimeout();
    assert.equal(repairRuns[2], '2026-04-20T10:05:00.000Z');
    assert.equal(timeoutQueue.filter((item) => item.delayMs === 60_000).length >= 2, true);

    await adapter.stop();
  });
});

test('pg-boss adapter runs reminder repair on coarse interval when qstash scheduler is enabled', async () => {
  const nowMs = Date.parse('2026-06-13T10:03:22.000Z');
  const timeoutQueue: Array<
    Readonly<{ delayMs: number; callback: () => void; handle: NodeJS.Timeout; cleared: boolean }>
  > = [];
  const repairRuns: string[] = [];
  const dispatchRuns: string[] = [];
  const originalProvider = process.env.REMINDER_SCHEDULER_PROVIDER;
  const originalCallbackBaseUrl = process.env.REMINDER_SCHEDULER_CALLBACK_BASE_URL;
  const originalToken = process.env.QSTASH_TOKEN;
  const originalCurrentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const originalNextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  const scheduler = {
    setInterval: (_callback: () => void, _ms: number): NodeJS.Timeout => {
      throw new Error('setInterval should not be used');
    },
    clearInterval: (_handle: NodeJS.Timeout): void => undefined,
    setTimeout: (callback: () => void, delayMs: number): NodeJS.Timeout => {
      const handle = { id: timeoutQueue.length + 1 } as unknown as NodeJS.Timeout;
      timeoutQueue.push({ delayMs, callback, handle, cleared: false });
      return handle;
    },
    clearTimeout: (handle: NodeJS.Timeout): void => {
      const index = timeoutQueue.findIndex((item) => item.handle === handle);
      if (index >= 0) {
        timeoutQueue[index] = { ...timeoutQueue[index], cleared: true };
      }
    },
  };

  process.env.REMINDER_SCHEDULER_PROVIDER = 'qstash';
  process.env.REMINDER_SCHEDULER_CALLBACK_BASE_URL = 'https://api.example.test';
  try {
    process.env.QSTASH_TOKEN = 'qstash-token';
    process.env.QSTASH_CURRENT_SIGNING_KEY = 'current-signing-key';
    process.env.QSTASH_NEXT_SIGNING_KEY = 'next-signing-key';
    const adapter = createPgBossAdapter({
      scheduler,
      now: () => new Date(nowMs),
      reminderRepairIntervalMs: 15 * 60 * 1000,
      reminderRepairJob: {
        run: async () => {
          repairRuns.push(new Date(nowMs).toISOString());
          return { candidates: 0, executed: 0, scheduled: 0 };
        },
      },
      dispatchJob: {
        run: async () => {
          dispatchRuns.push(new Date(nowMs).toISOString());
          return {
            cronKey: 'check-reminders',
            since: new Date(nowMs),
            now: new Date(nowMs),
            scanned: 0,
            enqueued: 0,
            duplicates: 0,
          };
        },
      },
      subscriptionDispatchJob: createNoopSubscriptionDispatchJob(),
      logger: { info: () => undefined, error: () => undefined },
    });

    await adapter.start();
    await Promise.resolve();
    assert.deepEqual(repairRuns, ['2026-06-13T10:03:22.000Z']);
    assert.deepEqual(dispatchRuns, []);
    assert.equal((await adapter.health()).details?.dispatchMode, 'scheduler-repair');
    await adapter.stop();
  } finally {
    if (originalProvider === undefined) {
      delete process.env.REMINDER_SCHEDULER_PROVIDER;
    } else {
      process.env.REMINDER_SCHEDULER_PROVIDER = originalProvider;
    }
    if (originalCallbackBaseUrl === undefined) {
      delete process.env.REMINDER_SCHEDULER_CALLBACK_BASE_URL;
    } else {
      process.env.REMINDER_SCHEDULER_CALLBACK_BASE_URL = originalCallbackBaseUrl;
    }
    if (originalToken === undefined) {
      delete process.env.QSTASH_TOKEN;
    } else {
      process.env.QSTASH_TOKEN = originalToken;
    }
    if (originalCurrentSigningKey === undefined) {
      delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    } else {
      process.env.QSTASH_CURRENT_SIGNING_KEY = originalCurrentSigningKey;
    }
    if (originalNextSigningKey === undefined) {
      delete process.env.QSTASH_NEXT_SIGNING_KEY;
    } else {
      process.env.QSTASH_NEXT_SIGNING_KEY = originalNextSigningKey;
    }
  }
});

test('pg-boss adapter preserves legacy dispatch mode when scheduler provider is disabled', async () => {
  const nowMs = Date.parse('2026-06-13T10:03:22.000Z');
  const repairRuns: string[] = [];
  const dispatchRuns: string[] = [];
  const originalProvider = process.env.REMINDER_SCHEDULER_PROVIDER;
  const originalCallbackBaseUrl = process.env.REMINDER_SCHEDULER_CALLBACK_BASE_URL;
  const originalToken = process.env.QSTASH_TOKEN;
  const originalCurrentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const originalNextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;

  process.env.REMINDER_SCHEDULER_PROVIDER = 'disabled';
  delete process.env.REMINDER_SCHEDULER_CALLBACK_BASE_URL;
  delete process.env.QSTASH_TOKEN;
  delete process.env.QSTASH_CURRENT_SIGNING_KEY;
  delete process.env.QSTASH_NEXT_SIGNING_KEY;

  try {
    const adapter = createPgBossAdapter({
      now: () => new Date(nowMs),
      reminderRepairIntervalMs: 15 * 60 * 1000,
      reminderRepairJob: {
        run: async () => {
          repairRuns.push(new Date(nowMs).toISOString());
          return { candidates: 0, executed: 0, scheduled: 0 };
        },
      },
      dispatchJob: {
        run: async () => {
          dispatchRuns.push(new Date(nowMs).toISOString());
          return {
            cronKey: 'check-reminders',
            since: new Date(nowMs),
            now: new Date(nowMs),
            scanned: 0,
            enqueued: 0,
            duplicates: 0,
          };
        },
      },
      subscriptionDispatchJob: createNoopSubscriptionDispatchJob(),
      logger: { info: () => undefined, error: () => undefined },
    });

    await adapter.start();
    await Promise.resolve();
    assert.deepEqual(dispatchRuns, ['2026-06-13T10:03:22.000Z']);
    assert.deepEqual(repairRuns, []);
    assert.equal((await adapter.health()).details?.dispatchMode, 'legacy-dispatch');
    await adapter.stop();
  } finally {
    if (originalProvider === undefined) {
      delete process.env.REMINDER_SCHEDULER_PROVIDER;
    } else {
      process.env.REMINDER_SCHEDULER_PROVIDER = originalProvider;
    }
    if (originalCallbackBaseUrl === undefined) {
      delete process.env.REMINDER_SCHEDULER_CALLBACK_BASE_URL;
    } else {
      process.env.REMINDER_SCHEDULER_CALLBACK_BASE_URL = originalCallbackBaseUrl;
    }
    if (originalToken === undefined) {
      delete process.env.QSTASH_TOKEN;
    } else {
      process.env.QSTASH_TOKEN = originalToken;
    }
    if (originalCurrentSigningKey === undefined) {
      delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    } else {
      process.env.QSTASH_CURRENT_SIGNING_KEY = originalCurrentSigningKey;
    }
    if (originalNextSigningKey === undefined) {
      delete process.env.QSTASH_NEXT_SIGNING_KEY;
    } else {
      process.env.QSTASH_NEXT_SIGNING_KEY = originalNextSigningKey;
    }
  }
});

test('pg-boss adapter stop does not re-arm reminder repair timer after in-flight timed run completes', async () => {
  let nowMs = Date.parse('2026-04-20T10:03:22.345Z');
  const timeoutQueue: Array<
    Readonly<{ handle: NodeJS.Timeout; delayMs: number; callback: () => void; cleared: boolean }>
  > = [];

  const scheduler = {
    setInterval: (_callback: () => void, _ms: number): NodeJS.Timeout => {
      throw new Error('setInterval should not be used for reminder repair scheduling');
    },
    clearInterval: (_handle: NodeJS.Timeout): void => {
      // no-op
    },
    setTimeout: (callback: () => void, ms: number): NodeJS.Timeout => {
      const handle = { id: timeoutQueue.length + 1 } as unknown as NodeJS.Timeout;
      timeoutQueue.push({
        handle,
        delayMs: ms,
        callback,
        cleared: false,
      });
      return handle;
    },
    clearTimeout: (handle: NodeJS.Timeout): void => {
      for (let index = 0; index < timeoutQueue.length; index += 1) {
        if (timeoutQueue[index].handle === handle) {
          timeoutQueue[index] = {
            ...timeoutQueue[index],
            cleared: true,
          };
        }
      }
    },
  };

  let runCount = 0;
  let releaseTimedRun: () => void = () => {
    // initialized for strict mode
  };
  const timedRunGate = new Promise<void>((resolve) => {
    releaseTimedRun = resolve;
  });

  await withQstashSchedulerEnv(async () => {
    const adapter = createPgBossAdapter({
      scheduler,
      now: () => new Date(nowMs),
      reminderRepairIntervalMs: 60_000,
      reminderRepairJob: {
        run: async () => {
          runCount += 1;
          // Block the first timeout-triggered cycle so stop() races with in-flight repair.
          if (runCount === 2) {
            await timedRunGate;
          }

          return { candidates: 0, executed: 0, scheduled: 0 };
        },
      },
      subscriptionDispatchJob: createNoopSubscriptionDispatchJob(),
      logger: {
        info: (_message: string) => {
          // no-op
        },
        error: (_message: string, _error?: unknown) => {
          // no-op
        },
      },
    });

    await adapter.start();
    assert.equal(runCount, 1);

    const firstTimeout = timeoutQueue.find((item) => !item.cleared);
    assert.ok(firstTimeout);
    nowMs += firstTimeout.delayMs;

    const firstTimeoutIndex = timeoutQueue.findIndex((item) => item === firstTimeout);
    timeoutQueue[firstTimeoutIndex] = {
      ...firstTimeout,
      cleared: true,
    };
    firstTimeout.callback();

    await waitFor(() => runCount >= 2, 500);

    const stopPromise = adapter.stop();
    releaseTimedRun();
    await stopPromise;

    const pendingTimeouts = timeoutQueue.filter((item) => !item.cleared);
    assert.equal(pendingTimeouts.length, 0);
  });
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
    adapter: createPgBossAdapter({
      dispatchJob: {
        run: async () => createNoopDispatchResult(new Date('2026-06-13T10:03:22.000Z')),
      },
      reminderRepairJob: {
        run: async () => ({ candidates: 0, executed: 0, scheduled: 0 }),
      },
      subscriptionDispatchJob: createNoopSubscriptionDispatchJob(),
      logger: {
        info: (_message: string) => {
          // no-op
        },
        error: (_message: string, _error?: unknown) => {
          // no-op
        },
      },
    }),
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

test('reminder runtime module can initialize injected runtime without DATABASE_URL', async () => {
  const runtimeModuleUrl = new URL('../reminders/runtime.js', import.meta.url).href;
  const result = await execFileAsync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        const { createReminderSchedulerRuntime } = await import(${JSON.stringify(runtimeModuleUrl)});
        const remindersRepository = {
          listByUser: async () => [],
          listRepairCandidates: async () => [],
          findById: async () => null,
          findByIdForUser: async () => null,
          create: async (input) => input,
          patch: async () => null,
          advanceAfterDelivery: async () => null,
          deleteByIdForUser: async () => false,
        };
        const runtime = createReminderSchedulerRuntime({
          remindersRepository,
          deliveriesRepository: {
            insertPending: async () => ({ inserted: false, delivery: {
              id: 'delivery-1',
              reminderId: 'reminder-1',
              userId: 'user-1',
              occurrenceAt: new Date('2026-06-13T10:05:00.000Z'),
              reminderVersion: 1,
              deliveryKey: 'delivery-1',
              status: 'pending',
              providerMessageId: null,
              attemptCount: 0,
              createdAt: new Date('2026-06-13T10:00:00.000Z'),
              sentAt: null,
              failureReason: null,
            } }),
            markSent: async () => undefined,
            markFailed: async () => undefined,
            markCanceled: async () => undefined,
            markStale: async () => undefined,
          },
          noteChangeEventsRepository: {
            isDuplicate: async () => false,
            appendEvent: async () => undefined,
          },
          deviceTokensRepository: {
            listByUserId: async () => [],
            listUserIdsWithTokens: async () => [],
            deleteByDeviceIdForUser: async () => false,
          },
          pushProvider: {
            sendToToken: async () => ({ ok: true }),
          },
          schedulerConfig: {
            REMINDER_SCHEDULER_PROVIDER: 'disabled',
          },
        });
        if (runtime.schedulerCallbacksEnabled !== false) {
          throw new Error('Expected disabled scheduler callbacks');
        }
      `,
    ],
    {
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => key !== 'DATABASE_URL'),
      ),
    },
  );

  assert.equal(result.stderr, '');
});

test('pg-boss adapter can start with injected jobs without DATABASE_URL', async () => {
  const workerModuleUrl = new URL('../worker/boss-adapter.js', import.meta.url).href;
  const result = await execFileAsync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        const { createPgBossAdapter } = await import(${JSON.stringify(workerModuleUrl)});
        const adapter = createPgBossAdapter({
          dispatchJob: {
            run: async () => ({
              cronKey: 'check-reminders',
              since: new Date('2026-06-13T10:03:22.000Z'),
              now: new Date('2026-06-13T10:03:22.000Z'),
              scanned: 0,
              enqueued: 0,
              duplicates: 0,
            }),
          },
          reminderRepairJob: {
            run: async () => ({ candidates: 0, executed: 0, scheduled: 0 }),
          },
          subscriptionDispatchJob: {
            run: async () => ({
              cronKey: 'subscription-reminders',
              since: new Date('2026-06-13T10:03:22.000Z'),
              now: new Date('2026-06-13T10:03:22.000Z'),
              scanned: 0,
              enqueued: 0,
              duplicates: 0,
            }),
          },
          logger: { info: () => undefined, error: () => undefined },
        });
        await adapter.start();
        await adapter.stop();
      `,
    ],
    {
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => key !== 'DATABASE_URL'),
      ),
    },
  );

  assert.equal(result.stderr, '');
});

test('api server emits cors headers only for allowed origins', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllowedOrigins = process.env.CORS_ALLOWED_ORIGINS;

  process.env.NODE_ENV = 'production';
  process.env.CORS_ALLOWED_ORIGINS = 'https://app.example.com';

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

  const server = api.listen(0);

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const allowedResponse = await fetch(`${baseUrl}/api/sample`, {
      headers: {
        Origin: 'https://app.example.com',
      },
    });

    assert.equal(allowedResponse.status, 200);
    assert.equal(
      allowedResponse.headers.get('access-control-allow-origin'),
      'https://app.example.com',
    );
    assert.equal(allowedResponse.headers.get('access-control-allow-credentials'), 'true');

    const disallowedResponse = await fetch(`${baseUrl}/api/sample`, {
      headers: {
        Origin: 'https://evil.example.com',
      },
    });

    assert.equal(disallowedResponse.status, 200);
    assert.equal(disallowedResponse.headers.get('access-control-allow-origin'), null);

    const preflightResponse = await fetch(`${baseUrl}/api/sample`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.example.com',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });

    assert.equal(preflightResponse.status, 204);
    assert.equal(
      preflightResponse.headers.get('access-control-allow-origin'),
      'https://app.example.com',
    );
    assert.equal(
      preflightResponse.headers.get('access-control-allow-methods'),
      'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    );
    assert.equal(
      preflightResponse.headers.get('access-control-allow-headers'),
      'authorization,content-type',
    );
    assert.equal(preflightResponse.headers.get('access-control-allow-credentials'), 'true');

    const disallowedPreflightResponse = await fetch(`${baseUrl}/api/sample`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example.com',
        'Access-Control-Request-Method': 'GET',
      },
    });

    assert.equal(disallowedPreflightResponse.status, 204);
    assert.equal(disallowedPreflightResponse.headers.get('access-control-allow-origin'), null);

    const plainOptionsResponse = await fetch(`${baseUrl}/api/sample`, {
      method: 'OPTIONS',
    });

    assert.equal(plainOptionsResponse.status, 404);
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

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }

    if (originalAllowedOrigins === undefined) {
      delete process.env.CORS_ALLOWED_ORIGINS;
    } else {
      process.env.CORS_ALLOWED_ORIGINS = originalAllowedOrigins;
    }
  }
});
