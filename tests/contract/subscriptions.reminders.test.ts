import { beforeEach, describe, expect, jest, test } from '@jest/globals';

type HandlerConfig = {
  handler: (...args: unknown[]) => unknown;
  [key: string]: unknown;
};

type Handler = (ctx: typeof mockCtx, args: Record<string, unknown>) => Promise<unknown>;

type MockQuery = {
  filter: jest.Mock<(...args: unknown[]) => MockQuery>;
  collect: jest.Mock<(...args: unknown[]) => Promise<unknown[]>>;
};

const mockQuery: MockQuery = {
  filter: jest.fn(),
  collect: jest.fn(),
};
mockQuery.filter.mockReturnValue(mockQuery);

const mockDb: {
  query: jest.Mock<(...args: unknown[]) => MockQuery>;
  patch: jest.Mock<(...args: unknown[]) => unknown>;
  delete: jest.Mock<(...args: unknown[]) => unknown>;
  get: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  insert: jest.Mock<(...args: unknown[]) => Promise<string>>;
} = {
  query: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
  get: jest.fn(),
  insert: jest.fn(),
};

const mockCtx = { db: mockDb };

const mockMutation = jest.fn((config: HandlerConfig) => ({
  ...config,
  _handler: config.handler,
}));

const mockQueryFunction = jest.fn((config: HandlerConfig) => ({
  ...config,
  _handler: config.handler,
}));

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
    mutation: mockMutation,
    query: mockQueryFunction,
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
        subscriptions: {
          getDueSubscriptionReminders: {},
          getDueTrialReminders: {},
          getSubscriptionsWithOverdueBilling: {},
          advanceSubscriptionAfterReminder: {},
          advanceSubscriptionAfterTrialReminder: {},
          advanceBillingSubscription: {},
        },
        push: {
          sendSubscriptionPush: {},
        },
      },
    },
  }),
  { virtual: true },
);

jest.mock(
  'convex/values',
  () => {
    const v: Record<string, jest.Mock> = {};
    const pass = () => ({});
    ['string', 'number', 'boolean', 'any', 'null', 'id'].forEach((k) => (v[k] = jest.fn(pass)));
    v['optional'] = jest.fn(pass);
    v['union'] = jest.fn(pass);
    v['array'] = jest.fn(pass);
    v['object'] = jest.fn(pass);
    return { v };
  },
  { virtual: true },
);

import {
  createSubscription,
  updateSubscription,
  getDueSubscriptionReminders,
  getDueTrialReminders,
  advanceSubscriptionAfterReminder,
  advanceSubscriptionAfterTrialReminder,
} from '../../convex/functions/subscriptions';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('subscriptions reminder contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.query.mockReturnValue(mockQuery);
    mockQuery.filter.mockReturnValue(mockQuery);
    mockDb.insert.mockResolvedValue('sub_123');
  });

  // ── createSubscription ────────────────────────────────────────────────────

  describe('createSubscription', () => {
    test('computes nextReminderAt for billing date', async () => {
      const handler = (createSubscription as unknown as { _handler: Handler })._handler;
      const now = Date.now();
      const billingDate = now + 5 * DAY_MS;

      await handler(mockCtx, {
        userId: 'user1',
        serviceName: 'Netflix',
        category: 'streaming',
        price: 14.99,
        currency: 'USD',
        billingCycle: 'monthly',
        nextBillingDate: billingDate,
        status: 'active',
        reminderDaysBefore: [3, 7],
      });

      const insertedDoc = mockDb.insert.mock.calls[0][1] as Record<string, unknown>;
      // Should compute nextReminderAt as billingDate - 7*DAY_MS (earliest future reminder)
      expect(insertedDoc.nextReminderAt).toBeDefined();
      expect(typeof insertedDoc.nextReminderAt).toBe('number');
      expect(insertedDoc.active).toBe(true);
    });

    test('computes nextTrialReminderAt when trialEndDate is provided', async () => {
      const handler = (createSubscription as unknown as { _handler: Handler })._handler;
      const now = Date.now();
      const billingDate = now + 30 * DAY_MS;
      const trialEnd = now + 5 * DAY_MS;

      await handler(mockCtx, {
        userId: 'user1',
        serviceName: 'Spotify',
        category: 'music',
        price: 9.99,
        currency: 'USD',
        billingCycle: 'monthly',
        nextBillingDate: billingDate,
        trialEndDate: trialEnd,
        status: 'active',
        reminderDaysBefore: [3, 7],
      });

      const insertedDoc = mockDb.insert.mock.calls[0][1] as Record<string, unknown>;
      expect(insertedDoc.nextTrialReminderAt).toBeDefined();
      expect(typeof insertedDoc.nextTrialReminderAt).toBe('number');
    });

    test('nextTrialReminderAt is undefined when no trialEndDate is provided', async () => {
      const handler = (createSubscription as unknown as { _handler: Handler })._handler;
      const now = Date.now();

      await handler(mockCtx, {
        userId: 'user1',
        serviceName: 'Netflix',
        category: 'streaming',
        price: 14.99,
        currency: 'USD',
        billingCycle: 'monthly',
        nextBillingDate: now + 30 * DAY_MS,
        status: 'active',
        reminderDaysBefore: [3],
      });

      const insertedDoc = mockDb.insert.mock.calls[0][1] as Record<string, unknown>;
      expect(insertedDoc.nextTrialReminderAt).toBeUndefined();
    });
  });

  // ── updateSubscription ────────────────────────────────────────────────────

  describe('updateSubscription', () => {
    test('recomputes nextTrialReminderAt when trialEndDate changes', async () => {
      const handler = (updateSubscription as unknown as { _handler: Handler })._handler;
      const now = Date.now();
      const existingSub = {
        _id: 'sub_1',
        nextBillingDate: now + 30 * DAY_MS,
        reminderDaysBefore: [3, 7],
        trialEndDate: now + 10 * DAY_MS,
      };
      mockDb.get.mockResolvedValue(existingSub);

      const newTrialEnd = now + 5 * DAY_MS;
      await handler(mockCtx, { id: 'sub_1', patch: { trialEndDate: newTrialEnd } });

      const patchCall = mockDb.patch.mock.calls[0][1] as Record<string, unknown>;
      expect(patchCall.nextTrialReminderAt).toBeDefined();
      expect(patchCall.nextReminderAt).toBeDefined();
    });

    test('clears nextTrialReminderAt when trialEndDate is removed', async () => {
      const handler = (updateSubscription as unknown as { _handler: Handler })._handler;
      const now = Date.now();
      mockDb.get.mockResolvedValue({
        _id: 'sub_1',
        nextBillingDate: now + 30 * DAY_MS,
        reminderDaysBefore: [3],
        trialEndDate: undefined,
      });

      await handler(mockCtx, { id: 'sub_1', patch: {} });

      const patchCall = mockDb.patch.mock.calls[0][1] as Record<string, unknown>;
      expect(patchCall.nextTrialReminderAt).toBeUndefined();
    });
  });

  // ── getDueSubscriptionReminders / getDueTrialReminders ────────────────────

  describe('getDueSubscriptionReminders', () => {
    test('returns subscriptions where nextReminderAt <= now', async () => {
      const handler = (getDueSubscriptionReminders as unknown as { _handler: Handler })._handler;
      const now = Date.now();
      const dueSub = { _id: 'sub_1', nextReminderAt: now - 1000, active: true, status: 'active' };
      mockQuery.collect.mockResolvedValue([dueSub]);

      const result = await handler(mockCtx, { now });
      expect(result).toEqual([dueSub]);
    });
  });

  describe('getDueTrialReminders', () => {
    test('returns subscriptions where nextTrialReminderAt <= now', async () => {
      const handler = (getDueTrialReminders as unknown as { _handler: Handler })._handler;
      const now = Date.now();
      const dueSub = {
        _id: 'sub_2',
        nextTrialReminderAt: now - 500,
        trialEndDate: now + 2 * DAY_MS,
        active: true,
        status: 'active',
      };
      mockQuery.collect.mockResolvedValue([dueSub]);

      const result = await handler(mockCtx, { now });
      expect(result).toEqual([dueSub]);
    });
  });

  // ── advanceSubscriptionAfterReminder ──────────────────────────────────────

  describe('advanceSubscriptionAfterReminder', () => {
    test('sets lastNotifiedBillingDate and recomputes nextReminderAt', async () => {
      const handler = (advanceSubscriptionAfterReminder as unknown as { _handler: Handler })
        ._handler;
      const now = Date.now();
      const billingDate = now + 2 * DAY_MS;
      mockDb.get.mockResolvedValue({
        _id: 'sub_1',
        nextBillingDate: billingDate,
        billingCycle: 'monthly',
        reminderDaysBefore: [1, 3],
      });

      await handler(mockCtx, { id: 'sub_1' });

      const patchCall = mockDb.patch.mock.calls[0][1] as Record<string, unknown>;
      expect(patchCall.lastNotifiedBillingDate).toBe(billingDate);
      expect(patchCall.nextReminderAt).toBeDefined();
    });

    test('advances billing date when already past', async () => {
      const handler = (advanceSubscriptionAfterReminder as unknown as { _handler: Handler })
        ._handler;
      const now = Date.now();
      const pastBillingDate = now - DAY_MS;
      mockDb.get.mockResolvedValue({
        _id: 'sub_1',
        nextBillingDate: pastBillingDate,
        billingCycle: 'monthly',
        reminderDaysBefore: [3],
      });

      await handler(mockCtx, { id: 'sub_1' });

      const patchCall = mockDb.patch.mock.calls[0][1] as Record<string, unknown>;
      expect(patchCall.nextBillingDate as number).toBeGreaterThan(now);
    });
  });

  // ── advanceSubscriptionAfterTrialReminder ─────────────────────────────────

  describe('advanceSubscriptionAfterTrialReminder', () => {
    test('sets lastNotifiedTrialEndDate and recomputes nextTrialReminderAt', async () => {
      const handler = (advanceSubscriptionAfterTrialReminder as unknown as { _handler: Handler })
        ._handler;
      const now = Date.now();
      const trialEndDate = now + 5 * DAY_MS;
      mockDb.get.mockResolvedValue({
        _id: 'sub_1',
        trialEndDate,
        reminderDaysBefore: [1, 3, 7],
      });

      await handler(mockCtx, { id: 'sub_1' });

      const patchCall = mockDb.patch.mock.calls[0][1] as Record<string, unknown>;
      expect(patchCall.lastNotifiedTrialEndDate).toBe(trialEndDate);
    });

    test('does nothing when trialEndDate is missing', async () => {
      const handler = (advanceSubscriptionAfterTrialReminder as unknown as { _handler: Handler })
        ._handler;
      mockDb.get.mockResolvedValue({
        _id: 'sub_1',
        trialEndDate: undefined,
        reminderDaysBefore: [3],
      });

      await handler(mockCtx, { id: 'sub_1' });

      expect(mockDb.patch).not.toHaveBeenCalled();
    });
  });
});
