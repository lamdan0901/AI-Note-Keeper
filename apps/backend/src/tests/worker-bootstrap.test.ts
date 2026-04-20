import assert from 'node:assert/strict';
import test from 'node:test';

import { createApiServer } from '../runtime/createApiServer.js';
import { createInFlightPushJobTracker, createPgBossAdapter } from '../worker/boss-adapter.js';
import { startWorker } from '../worker/index.js';

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

test('pg-boss adapter aligns recurring dispatch to exact interval boundaries', async () => {
  let nowMs = Date.parse('2026-04-20T10:03:22.345Z');
  const timeoutQueue: Array<
    Readonly<{ handle: NodeJS.Timeout; delayMs: number; callback: () => void; cleared: boolean }>
  > = [];

  const scheduler = {
    setInterval: (_callback: () => void, _ms: number): NodeJS.Timeout => {
      throw new Error('setInterval should not be used for dispatch scheduling');
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

  const runDispatchTimes: string[] = [];
  const adapter = createPgBossAdapter({
    dispatchIntervalMs: 60_000,
    scheduler,
    now: () => new Date(nowMs),
    dispatchJob: {
      run: async () => {
        const runNow = new Date(nowMs);
        runDispatchTimes.push(runNow.toISOString());
        return {
          cronKey: 'check-reminders',
          since: runNow,
          now: runNow,
          scanned: 0,
          enqueued: 0,
          duplicates: 0,
        };
      },
    },
    logger: {
      info: (_message: string) => {
        // no-op
      },
      error: (_message: string, _error?: unknown) => {
        // no-op
      },
    },
  });

  let nextTimeoutIndex = 0;

  const runNextTimeout = async (): Promise<void> => {
    while (nextTimeoutIndex < timeoutQueue.length && timeoutQueue[nextTimeoutIndex].cleared) {
      nextTimeoutIndex += 1;
    }

    assert.ok(nextTimeoutIndex < timeoutQueue.length);
    const next = timeoutQueue[nextTimeoutIndex];
    timeoutQueue[nextTimeoutIndex] = {
      ...next,
      cleared: true,
    };
    nextTimeoutIndex += 1;

    nowMs += next.delayMs;
    next.callback();
    await Promise.resolve();
    await Promise.resolve();
  };

  await adapter.start();

  assert.equal(runDispatchTimes.length, 1);
  assert.equal(runDispatchTimes[0], '2026-04-20T10:03:22.345Z');
  assert.equal(timeoutQueue.length, 1);
  assert.equal(timeoutQueue[0].delayMs, 37_655);

  await runNextTimeout();
  assert.equal(runDispatchTimes[1], '2026-04-20T10:04:00.000Z');
  assert.equal(timeoutQueue.length, 2);
  assert.equal(timeoutQueue[1].delayMs, 60_000);

  await runNextTimeout();
  assert.equal(runDispatchTimes[2], '2026-04-20T10:05:00.000Z');
  assert.equal(timeoutQueue.length, 3);
  assert.equal(timeoutQueue[2].delayMs, 60_000);

  await adapter.stop();
});

test('pg-boss adapter stop does not re-arm dispatch timer after in-flight timed run completes', async () => {
  let nowMs = Date.parse('2026-04-20T10:03:22.345Z');
  const timeoutQueue: Array<
    Readonly<{ handle: NodeJS.Timeout; delayMs: number; callback: () => void; cleared: boolean }>
  > = [];

  const scheduler = {
    setInterval: (_callback: () => void, _ms: number): NodeJS.Timeout => {
      throw new Error('setInterval should not be used for dispatch scheduling');
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

  const adapter = createPgBossAdapter({
    dispatchIntervalMs: 60_000,
    scheduler,
    now: () => new Date(nowMs),
    dispatchJob: {
      run: async () => {
        runCount += 1;
        const runNow = new Date(nowMs);

        // Block the first timeout-triggered cycle so stop() races with in-flight dispatch.
        if (runCount === 2) {
          await timedRunGate;
        }

        return {
          cronKey: 'check-reminders',
          since: runNow,
          now: runNow,
          scanned: 0,
          enqueued: 0,
          duplicates: 0,
        };
      },
    },
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

test('pg-boss adapter stop prevents new push jobs after shutdown resolves', async () => {
  const now = new Date('2026-04-20T10:00:00.000Z');
  let handledCount = 0;
  let releaseFirstPush: () => void = () => {
    // initialized for strict mode
  };
  const firstPushGate = new Promise<void>((resolve) => {
    releaseFirstPush = resolve;
  });

  const adapter = createPgBossAdapter({
    dispatchIntervalMs: 60_000,
    maxConcurrentPushDispatches: 1,
    scanner: {
      scanDueReminders: async () => ({
        since: now,
        now,
        reminders: [
          {
            noteId: 'note-1',
            userId: 'user-1',
            triggerTime: now,
          },
          {
            noteId: 'note-2',
            userId: 'user-1',
            triggerTime: now,
          },
        ],
      }),
    },
    cronStateRepository: {
      getLastCheckedAt: async () => null,
      upsertLastCheckedAt: async () => undefined,
    },
    deviceTokensRepository: {
      listByUserId: async () => [
        {
          id: 'token-1',
          userId: 'user-1',
          deviceId: 'device-1',
          fcmToken: 'fcm-token-1',
          platform: 'android',
          updatedAt: now,
          createdAt: now,
        },
      ],
      deleteByDeviceIdForUser: async () => false,
    },
    pushJobHandler: {
      handle: async (job) => {
        handledCount += 1;

        if (handledCount === 1) {
          await firstPushGate;
        }

        return {
          processed: job.tokens.length,
          delivered: job.tokens.length,
          retriesScheduled: 0,
          unregisteredRemoved: 0,
          terminalFailures: 0,
        };
      },
    },
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
  await waitFor(() => handledCount >= 1, 500);

  const stopPromise = adapter.stop();
  releaseFirstPush();
  await stopPromise;

  const handledCountAtStop = handledCount;
  await Promise.resolve();
  await Promise.resolve();

  assert.ok(handledCountAtStop >= 1);
  assert.equal(handledCount, handledCountAtStop);
});

test('pg-boss adapter dispatches due reminders into push handler with resolved device tokens', async () => {
  const now = new Date('2026-04-20T10:00:00.000Z');
  const handledJobs: Array<
    Readonly<{
      userId: string;
      reminderId: string;
      changeEventId: string;
      tokens: ReadonlyArray<Readonly<{ deviceId: string; fcmToken: string }>>;
    }>
  > = [];

  const adapter = createPgBossAdapter({
    dispatchIntervalMs: 10,
    scanner: {
      scanDueReminders: async () => ({
        since: now,
        now,
        reminders: [
          {
            noteId: 'note-1',
            userId: 'user-1',
            triggerTime: now,
          },
        ],
      }),
    },
    cronStateRepository: {
      getLastCheckedAt: async () => null,
      upsertLastCheckedAt: async () => undefined,
    },
    deviceTokensRepository: {
      listByUserId: async () => [
        {
          id: 'token-1',
          userId: 'user-1',
          deviceId: 'device-1',
          fcmToken: 'fcm-token-1',
          platform: 'android',
          updatedAt: now,
          createdAt: now,
        },
      ],
      deleteByDeviceIdForUser: async () => false,
    },
    pushJobHandler: {
      handle: async (job) => {
        handledJobs.push({
          userId: job.userId,
          reminderId: job.reminderId,
          changeEventId: job.changeEventId,
          tokens: job.tokens,
        });

        return {
          processed: job.tokens.length,
          delivered: job.tokens.length,
          retriesScheduled: 0,
          unregisteredRemoved: 0,
          terminalFailures: 0,
        };
      },
    },
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
  await waitFor(() => handledJobs.length >= 1, 500);
  await adapter.stop();

  assert.ok(handledJobs.length >= 1);
  assert.equal(handledJobs[0].userId, 'user-1');
  assert.equal(handledJobs[0].reminderId, 'note-1');
  assert.equal(handledJobs[0].changeEventId, 'note-1-1776679200000');
  assert.deepEqual(handledJobs[0].tokens, [{ deviceId: 'device-1', fcmToken: 'fcm-token-1' }]);
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
