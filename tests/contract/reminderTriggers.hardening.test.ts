import { beforeEach, describe, expect, jest, test } from '@jest/globals';

type HandlerConfig = {
  handler: (...args: unknown[]) => unknown;
  [key: string]: unknown;
};

const mockInternalMutation = jest.fn((config: HandlerConfig) => ({
  ...config,
  _handler: config.handler,
}));

const mockInternalQuery = jest.fn((config: HandlerConfig) => ({
  ...config,
  _handler: config.handler,
}));

const mockInternalAction = jest.fn((config: HandlerConfig) => ({
  ...config,
  _handler: config.handler,
}));

jest.mock(
  '../../convex/_generated/server',
  () => ({
    internalMutation: mockInternalMutation,
    internalQuery: mockInternalQuery,
    internalAction: mockInternalAction,
  }),
  { virtual: true },
);

jest.mock(
  '../../convex/_generated/api',
  () => ({
    internal: {
      functions: {
        reminderTriggers: {
          getCronWatermark: { _name: 'getCronWatermark' },
          getDueReminders: { _name: 'getDueReminders' },
          claimTriggerEvent: { _name: 'claimTriggerEvent' },
          clearTriggerEventClaim: { _name: 'clearTriggerEventClaim' },
          cleanupExpiredTriggerEventClaims: { _name: 'cleanupExpiredTriggerEventClaims' },
          markReminderTriggered: { _name: 'markReminderTriggered' },
          updateCronWatermark: { _name: 'updateCronWatermark' },
        },
        push: {
          sendPush: { _name: 'sendPush' },
        },
      },
    },
  }),
  { virtual: true },
);

const mockComputeNextTrigger = jest.fn();
jest.mock(
  '../../packages/shared/utils/recurrence',
  () => ({
    computeNextTrigger: mockComputeNextTrigger,
  }),
  { virtual: true },
);

import {
  claimTriggerEvent,
  clearTriggerEventClaim,
  cleanupExpiredTriggerEventClaims,
  markReminderTriggered,
  checkAndTriggerReminders,
} from '../../convex/functions/reminderTriggers';

describe('reminderTriggers hardening', () => {
  type MockFn = jest.Mock;
  type TestCtx = {
    db?: {
      query?: MockFn;
      insert?: MockFn;
      delete?: MockFn;
      patch?: MockFn;
    };
    runQuery?: MockFn;
    runAction?: MockFn;
    runMutation?: MockFn;
  };
  type HandlerFn = (ctx: TestCtx, args: Record<string, unknown>) => Promise<unknown>;
  type HandlerModule = { _handler: HandlerFn };
  const getHandler = (mod: unknown): HandlerFn => (mod as HandlerModule)._handler;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('claimTriggerEvent returns false when claim exists', async () => {
    const existing = { _id: 'claim-1', key: 'trigger-event:note-1-1000', lastCheckedAt: 1 };

    const queryChain = {
      filter: jest.fn().mockReturnThis(),
      first: jest.fn(() => Promise.resolve(existing)),
    };

    const ctx: TestCtx = {
      db: {
        query: jest.fn().mockReturnValue(queryChain),
        insert: jest.fn(),
      },
    };

    const handler = getHandler(claimTriggerEvent);

    const claimed = await handler(ctx, { eventId: 'note-1-1000', now: 1000 });

    expect(claimed).toBe(false);
    expect(ctx.db?.insert).not.toHaveBeenCalled();
  });

  test('claimTriggerEvent inserts claim when absent', async () => {
    const queryChain = {
      filter: jest.fn().mockReturnThis(),
      first: jest.fn(() => Promise.resolve(null)),
    };

    const ctx: TestCtx = {
      db: {
        query: jest.fn().mockReturnValue(queryChain),
        insert: jest.fn(() => Promise.resolve(undefined)),
      },
    };

    const handler = getHandler(claimTriggerEvent);

    const claimed = await handler(ctx, { eventId: 'note-1-1000', now: 1000 });

    expect(claimed).toBe(true);
    expect(ctx.db?.insert).toHaveBeenCalledWith('cronState', {
      key: 'trigger-event:note-1-1000',
      lastCheckedAt: 1000,
    });
  });

  test('clearTriggerEventClaim deletes existing claim', async () => {
    const existing = { _id: 'claim-1', key: 'trigger-event:note-1-1000', lastCheckedAt: 1 };
    const queryChain = {
      filter: jest.fn().mockReturnThis(),
      first: jest.fn(() => Promise.resolve(existing)),
    };

    const ctx: TestCtx = {
      db: {
        query: jest.fn().mockReturnValue(queryChain),
        delete: jest.fn(() => Promise.resolve(undefined)),
      },
    };

    const handler = getHandler(clearTriggerEventClaim);

    await handler(ctx, { eventId: 'note-1-1000' });

    expect(ctx.db?.delete).toHaveBeenCalledWith('claim-1');
  });

  test('markReminderTriggered clears legacy triggerAt when recurrence advances', async () => {
    const now = 2000;
    const next = 5000;

    const note = {
      _id: 'doc-1',
      id: 'note-1',
      repeat: { kind: 'daily', interval: 1 },
      startAt: 1000,
      baseAtLocal: '2026-01-01T09:00:00',
      triggerAt: 1000,
      nextTriggerAt: 1000,
      snoozedUntil: undefined,
    };

    const queryChain = {
      filter: jest.fn().mockReturnThis(),
      first: jest.fn(() => Promise.resolve(note)),
    };

    const ctx: TestCtx = {
      db: {
        query: jest.fn().mockReturnValue(queryChain),
        patch: jest.fn(() => Promise.resolve(undefined)),
      },
    };

    mockComputeNextTrigger.mockReturnValue(next);
    const realNow = Date.now;
    Date.now = jest.fn(() => now);

    const handler = getHandler(markReminderTriggered);
    await handler(ctx, { noteId: 'note-1' });

    Date.now = realNow;

    expect(ctx.db?.patch).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({
        triggerAt: undefined,
        nextTriggerAt: next,
        lastFiredAt: now,
        scheduleStatus: 'scheduled',
      }),
    );
  });

  test('markReminderTriggered derives baseAtLocal from local clock, not toISOString UTC fallback', async () => {
    const now = 3000;
    const next = 9000;
    const startAt = new Date('2026-03-10T15:00:00').getTime();

    const note = {
      _id: 'doc-2',
      id: 'note-2',
      repeat: { kind: 'daily', interval: 1 },
      startAt,
      triggerAt: startAt,
      nextTriggerAt: startAt,
      snoozedUntil: undefined,
      baseAtLocal: undefined,
    };

    const queryChain = {
      filter: jest.fn().mockReturnThis(),
      first: jest.fn(() => Promise.resolve(note)),
    };

    const ctx: TestCtx = {
      db: {
        query: jest.fn().mockReturnValue(queryChain),
        patch: jest.fn(() => Promise.resolve(undefined)),
      },
    };

    mockComputeNextTrigger.mockReturnValue(next);
    const realNow = Date.now;
    Date.now = jest.fn(() => now);

    const toIsoSpy = jest
      .spyOn(Date.prototype, 'toISOString')
      .mockReturnValue('2099-12-31T23:59:59.000Z');

    const handler = getHandler(markReminderTriggered);
    await handler(ctx, { noteId: 'note-2' });

    Date.now = realNow;
    toIsoSpy.mockRestore();

    const expectedLocalBase = (() => {
      const d = new Date(startAt);
      const pad = (n: number) => String(n).padStart(2, '0');
      return (
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
      );
    })();

    expect(mockComputeNextTrigger).toHaveBeenCalledWith(
      now,
      startAt,
      expectedLocalBase,
      note.repeat,
    );

    expect(ctx.db?.patch).toHaveBeenCalledWith(
      'doc-2',
      expect.objectContaining({
        baseAtLocal: expectedLocalBase,
      }),
    );
  });

  test.each([
    ['weekly', { kind: 'weekly', interval: 1, weekdays: [2, 4] }],
    ['monthly', { kind: 'monthly', interval: 1, mode: 'day_of_month' }],
    ['custom-days', { kind: 'custom', interval: 2, frequency: 'days' }],
  ] as const)(
    'markReminderTriggered handles %s repeat using local baseAtLocal fallback',
    async (_label, repeatRule) => {
      const now = 4000;
      const next = 10000;
      const startAt = new Date('2026-03-10T15:00:00').getTime();

      const note = {
        _id: 'doc-kind',
        id: 'note-kind',
        repeat: repeatRule,
        startAt,
        triggerAt: startAt,
        nextTriggerAt: startAt,
        snoozedUntil: undefined,
        baseAtLocal: undefined,
      };

      const queryChain = {
        filter: jest.fn().mockReturnThis(),
        first: jest.fn(() => Promise.resolve(note)),
      };

      const ctx: TestCtx = {
        db: {
          query: jest.fn().mockReturnValue(queryChain),
          patch: jest.fn(() => Promise.resolve(undefined)),
        },
      };

      mockComputeNextTrigger.mockReturnValue(next);
      const realNow = Date.now;
      Date.now = jest.fn(() => now);

      const toIsoSpy = jest
        .spyOn(Date.prototype, 'toISOString')
        .mockReturnValue('2099-12-31T23:59:59.000Z');

      const handler = getHandler(markReminderTriggered);
      await handler(ctx, { noteId: 'note-kind' });

      Date.now = realNow;
      toIsoSpy.mockRestore();

      const expectedLocalBase = (() => {
        const d = new Date(startAt);
        const pad = (n: number) => String(n).padStart(2, '0');
        return (
          `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
          `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
        );
      })();

      expect(mockComputeNextTrigger).toHaveBeenCalledWith(
        now,
        startAt,
        expectedLocalBase,
        repeatRule,
      );

      expect(ctx.db?.patch).toHaveBeenCalledWith(
        'doc-kind',
        expect.objectContaining({
          baseAtLocal: expectedLocalBase,
          nextTriggerAt: next,
          triggerAt: undefined,
          scheduleStatus: 'scheduled',
        }),
      );
    },
  );

  test('markReminderTriggered repairs stale UTC-derived baseAtLocal', async () => {
    const now = 4100;
    const next = 12000;
    const startAt = new Date('2026-03-10T15:00:00').getTime();
    const utcDerived = new Date(startAt).toISOString().slice(0, 19);

    const note = {
      _id: 'doc-utc',
      id: 'note-utc',
      repeat: { kind: 'daily', interval: 1 },
      startAt,
      triggerAt: startAt,
      nextTriggerAt: startAt,
      snoozedUntil: undefined,
      baseAtLocal: utcDerived,
    };

    const queryChain = {
      filter: jest.fn().mockReturnThis(),
      first: jest.fn(() => Promise.resolve(note)),
    };

    const ctx: TestCtx = {
      db: {
        query: jest.fn().mockReturnValue(queryChain),
        patch: jest.fn(() => Promise.resolve(undefined)),
      },
    };

    mockComputeNextTrigger.mockReturnValue(next);
    const realNow = Date.now;
    Date.now = jest.fn(() => now);

    const handler = getHandler(markReminderTriggered);
    await handler(ctx, { noteId: 'note-utc' });

    Date.now = realNow;

    const expectedLocalBase = (() => {
      const d = new Date(startAt);
      const pad = (n: number) => String(n).padStart(2, '0');
      return (
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
      );
    })();

    expect(mockComputeNextTrigger).toHaveBeenCalledWith(
      now,
      startAt,
      expectedLocalBase,
      note.repeat,
    );

    expect(ctx.db?.patch).toHaveBeenCalledWith(
      'doc-utc',
      expect.objectContaining({
        baseAtLocal: expectedLocalBase,
      }),
    );
  });

  test('cleanupExpiredTriggerEventClaims removes only stale trigger-event keys', async () => {
    const entries = [
      { _id: 'a', key: 'check-reminders', lastCheckedAt: 1000 },
      { _id: 'b', key: 'trigger-event:note-1-1000', lastCheckedAt: 1000 },
      { _id: 'c', key: 'trigger-event:note-2-2000', lastCheckedAt: 5000 },
    ];

    const queryChain = {
      collect: jest.fn(() => Promise.resolve(entries)),
    };

    const ctx: TestCtx = {
      db: {
        query: jest.fn().mockReturnValue(queryChain),
        delete: jest.fn(() => Promise.resolve(undefined)),
      },
    };

    const handler = getHandler(cleanupExpiredTriggerEventClaims);
    const deletedCount = await handler(ctx, { cutoff: 3000 });

    expect(deletedCount).toBe(1);
    expect(ctx.db?.delete).toHaveBeenCalledTimes(1);
    expect(ctx.db?.delete).toHaveBeenCalledWith('b');
  });

  test('checkAndTriggerReminders keeps watermark behind earliest failed trigger and clears claim', async () => {
    const now = 5000;
    const since = 1000;
    const dueNote = {
      id: 'note-1',
      userId: 'user-1',
      triggerAt: 2000,
      nextTriggerAt: undefined,
      snoozedUntil: undefined,
    };

    let runQueryCalls = 0;
    const runQuery = jest.fn(() => {
      runQueryCalls += 1;
      if (runQueryCalls === 1) {
        return Promise.resolve({ key: 'check-reminders', lastCheckedAt: since });
      }
      return Promise.resolve([dueNote]);
    });

    const runAction = jest.fn(() => Promise.reject(new Error('push failure')));
    const runMutation = jest.fn().mockImplementation((fn: unknown, _args: unknown) => {
      void _args;
      const fnName = (fn as { _name?: string } | undefined)?._name;
      if (fnName === 'claimTriggerEvent') {
        return Promise.resolve(true);
      }
      if (fnName === 'clearTriggerEventClaim') {
        return Promise.resolve(undefined);
      }
      if (fnName === 'updateCronWatermark') {
        return Promise.resolve(undefined);
      }
      if (fnName === 'cleanupExpiredTriggerEventClaims') {
        return Promise.resolve(0);
      }
      return Promise.resolve(undefined);
    });

    const ctx: TestCtx = {
      runQuery,
      runAction,
      runMutation,
    };

    const realNow = Date.now;
    Date.now = jest.fn(() => now);

    const handler = getHandler(checkAndTriggerReminders);
    await handler(ctx, {});

    Date.now = realNow;

    expect(runMutation).toHaveBeenCalledWith(
      expect.objectContaining({ _name: 'clearTriggerEventClaim' }),
      { eventId: 'note-1-2000' },
    );

    expect(runMutation).toHaveBeenCalledWith(
      expect.objectContaining({ _name: 'updateCronWatermark' }),
      {
        key: 'check-reminders',
        lastCheckedAt: 1999,
      },
    );
  });

  test('checkAndTriggerReminders skips already-claimed event and still advances watermark', async () => {
    const now = 8000;
    const since = 7000;
    const dueNote = {
      id: 'note-claimed',
      userId: 'user-1',
      triggerAt: 7500,
      nextTriggerAt: undefined,
      snoozedUntil: undefined,
    };

    let runQueryCalls = 0;
    const runQuery = jest.fn(() => {
      runQueryCalls += 1;
      if (runQueryCalls === 1) {
        return Promise.resolve({ key: 'check-reminders', lastCheckedAt: since });
      }
      return Promise.resolve([dueNote]);
    });

    const runAction = jest.fn(() => Promise.resolve(undefined));
    const runMutation = jest.fn().mockImplementation((fn: unknown, _args: unknown) => {
      void _args;
      const fnName = (fn as { _name?: string } | undefined)?._name;
      if (fnName === 'claimTriggerEvent') {
        return Promise.resolve(false);
      }
      if (fnName === 'updateCronWatermark') {
        return Promise.resolve(undefined);
      }
      if (fnName === 'cleanupExpiredTriggerEventClaims') {
        return Promise.resolve(0);
      }
      return Promise.resolve(undefined);
    });

    const ctx: TestCtx = {
      runQuery,
      runAction,
      runMutation,
    };

    const realNow = Date.now;
    Date.now = jest.fn(() => now);

    const handler = getHandler(checkAndTriggerReminders);
    await handler(ctx, {});

    Date.now = realNow;

    expect(runAction).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalledWith(
      expect.objectContaining({ _name: 'markReminderTriggered' }),
      expect.anything(),
    );
    expect(runMutation).toHaveBeenCalledWith(
      expect.objectContaining({ _name: 'updateCronWatermark' }),
      {
        key: 'check-reminders',
        lastCheckedAt: now,
      },
    );
  });
});
