import assert from 'node:assert/strict';
import type { Server } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createTokenFactory } from '../../auth/tokens.js';
import { errorMiddleware, notFoundMiddleware } from '../../middleware/error-middleware.js';
import type { SubscriptionRecord } from '../../subscriptions/contracts.js';
import { createSubscriptionsRoutes } from '../../subscriptions/routes.js';
import type { SubscriptionsService } from '../../subscriptions/service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const createServiceDouble = (nowRef: Readonly<{ nowMs: () => number }>): SubscriptionsService => {
  const byUser = new Map<string, Map<string, SubscriptionRecord>>();

  const getUserMap = (userId: string): Map<string, SubscriptionRecord> => {
    const existing = byUser.get(userId);
    if (existing) {
      return existing;
    }

    const created = new Map<string, SubscriptionRecord>();
    byUser.set(userId, created);
    return created;
  };

  const computeNextReminderAt = (
    nextBillingDate: Date,
    reminderDaysBefore: ReadonlyArray<number>,
  ): Date | null => {
    const candidates = reminderDaysBefore
      .map((days) => nextBillingDate.getTime() - days * DAY_MS)
      .filter((candidate) => candidate > nowRef.nowMs())
      .sort((a, b) => a - b);

    return candidates.length > 0 ? new Date(candidates[0]) : null;
  };

  const computeNextTrialReminderAt = (
    trialEndDate: Date | null,
    reminderDaysBefore: ReadonlyArray<number>,
  ): Date | null => {
    if (!trialEndDate) {
      return null;
    }

    return computeNextReminderAt(trialEndDate, reminderDaysBefore);
  };

  return {
    list: async ({ userId }) => [...getUserMap(userId).values()].filter((entry) => entry.active),

    create: async (input) => {
      const now = new Date(nowRef.nowMs());
      const id = `sub-${getUserMap(input.userId).size + 1}`;
      const record: SubscriptionRecord = {
        id,
        userId: input.userId,
        serviceName: input.serviceName,
        category: input.category,
        price: input.price,
        currency: input.currency,
        billingCycle: input.billingCycle,
        billingCycleCustomDays: input.billingCycleCustomDays,
        nextBillingDate: input.nextBillingDate,
        notes: input.notes,
        trialEndDate: input.trialEndDate,
        status: input.status,
        reminderDaysBefore: [...input.reminderDaysBefore],
        nextReminderAt: computeNextReminderAt(input.nextBillingDate, input.reminderDaysBefore),
        lastNotifiedBillingDate: null,
        nextTrialReminderAt: computeNextTrialReminderAt(
          input.trialEndDate,
          input.reminderDaysBefore,
        ),
        lastNotifiedTrialEndDate: null,
        active: true,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      getUserMap(input.userId).set(id, record);
      return record;
    },

    update: async ({ subscriptionId, userId, patch }) => {
      const userSubscriptions = getUserMap(userId);
      const existing = userSubscriptions.get(subscriptionId);
      if (!existing) {
        const error = new Error('not_found');
        (error as unknown as { code: string; status: number; message: string }).code = 'not_found';
        (error as unknown as { code: string; status: number; message: string }).status = 404;
        (error as unknown as { code: string; status: number; message: string }).message =
          'Subscription not found';
        throw error;
      }

      const merged = {
        ...existing,
        ...patch,
      };

      const updated: SubscriptionRecord = {
        ...existing,
        ...patch,
        nextBillingDate: merged.nextBillingDate,
        trialEndDate: merged.trialEndDate,
        reminderDaysBefore: merged.reminderDaysBefore,
        nextReminderAt: computeNextReminderAt(merged.nextBillingDate, merged.reminderDaysBefore),
        nextTrialReminderAt: computeNextTrialReminderAt(
          merged.trialEndDate,
          merged.reminderDaysBefore,
        ),
        updatedAt: new Date(nowRef.nowMs()),
      };
      userSubscriptions.set(subscriptionId, updated);
      return updated;
    },

    trash: async ({ subscriptionId, userId }) => {
      const userSubscriptions = getUserMap(userId);
      const existing = userSubscriptions.get(subscriptionId);
      if (!existing) {
        return false;
      }

      userSubscriptions.set(subscriptionId, {
        ...existing,
        active: false,
        deletedAt: new Date(nowRef.nowMs()),
        updatedAt: new Date(nowRef.nowMs()),
      });
      return true;
    },

    restore: async ({ subscriptionId, userId }) => {
      const userSubscriptions = getUserMap(userId);
      const existing = userSubscriptions.get(subscriptionId);
      if (!existing) {
        return false;
      }

      userSubscriptions.set(subscriptionId, {
        ...existing,
        active: true,
        deletedAt: null,
        updatedAt: new Date(nowRef.nowMs()),
      });
      return true;
    },

    permanentlyDelete: async ({ subscriptionId, userId }) => {
      const userSubscriptions = getUserMap(userId);
      const existing = userSubscriptions.get(subscriptionId);
      if (!existing || existing.active) {
        return false;
      }

      userSubscriptions.delete(subscriptionId);
      return true;
    },

    purgeExpiredTrash: async ({ userId }) => {
      const userSubscriptions = getUserMap(userId);
      const cutoff = nowRef.nowMs() - 14 * DAY_MS;
      let deleted = 0;

      for (const [subscriptionId, subscription] of userSubscriptions.entries()) {
        const deletedAt = subscription.deletedAt?.getTime() ?? 0;
        if (subscription.active || deletedAt <= cutoff === false) {
          continue;
        }

        userSubscriptions.delete(subscriptionId);
        deleted += 1;
      }

      return deleted;
    },
  };
};

const startServer = async (
  service: SubscriptionsService,
): Promise<Readonly<{ baseUrl: string; close: () => Promise<void> }>> => {
  const app = express();
  app.use(express.json());
  app.use('/api/subscriptions', createSubscriptionsRoutes(service));
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

test('subscriptions routes derive reminder fields on create and update', async () => {
  let nowValue = 1_700_000_000_000;
  const service = createServiceDouble({ nowMs: () => nowValue });
  const server = await startServer(service);
  const token = await createAccessToken('user-1');

  try {
    const createResponse = await fetch(`${server.baseUrl}/api/subscriptions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        serviceName: 'Netflix',
        category: 'streaming',
        price: 10,
        currency: 'USD',
        billingCycle: 'monthly',
        billingCycleCustomDays: null,
        nextBillingDate: nowValue + 10 * DAY_MS,
        notes: null,
        trialEndDate: nowValue + 4 * DAY_MS,
        status: 'active',
        reminderDaysBefore: [2, 5],
      }),
    });

    assert.equal(createResponse.status, 201);
    const createdPayload = (await createResponse.json()) as {
      subscription: {
        id: string;
        nextReminderAt: string | null;
        nextTrialReminderAt: string | null;
      };
    };
    assert.ok(createdPayload.subscription.nextReminderAt);
    assert.ok(createdPayload.subscription.nextTrialReminderAt);

    nowValue += DAY_MS;
    const updateResponse = await fetch(
      `${server.baseUrl}/api/subscriptions/${createdPayload.subscription.id}`,
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          nextBillingDate: nowValue + 20 * DAY_MS,
          reminderDaysBefore: [3],
        }),
      },
    );

    assert.equal(updateResponse.status, 200);
    const updatedPayload = (await updateResponse.json()) as {
      subscription: { nextReminderAt: string | null };
    };
    assert.ok(updatedPayload.subscription.nextReminderAt);
  } finally {
    await server.close();
  }
});

test('subscriptions update enforces ownership by user-scoped lookup', async () => {
  let nowValue = 1_700_000_000_000;
  const service = createServiceDouble({ nowMs: () => nowValue });
  const server = await startServer(service);
  const ownerToken = await createAccessToken('owner');
  const otherToken = await createAccessToken('other');

  try {
    const createResponse = await fetch(`${server.baseUrl}/api/subscriptions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ownerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        serviceName: 'Prime',
        category: 'streaming',
        price: 15,
        currency: 'USD',
        billingCycle: 'monthly',
        billingCycleCustomDays: null,
        nextBillingDate: nowValue + 10 * DAY_MS,
        notes: null,
        trialEndDate: null,
        status: 'active',
        reminderDaysBefore: [2],
      }),
    });

    const createdPayload = (await createResponse.json()) as { subscription: { id: string } };

    const forbiddenUpdate = await fetch(
      `${server.baseUrl}/api/subscriptions/${createdPayload.subscription.id}`,
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${otherToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          price: 20,
        }),
      },
    );

    assert.equal(forbiddenUpdate.status, 500);
  } finally {
    await server.close();
  }
});

test('subscription purge uses 14-day deletedAt cutoff', async () => {
  let nowValue = 1_700_000_000_000;
  const service = createServiceDouble({ nowMs: () => nowValue });

  const created = await service.create({
    userId: 'user-1',
    serviceName: 'Trashable',
    category: 'misc',
    price: 1,
    currency: 'USD',
    billingCycle: 'monthly',
    billingCycleCustomDays: null,
    nextBillingDate: new Date(nowValue + 10 * DAY_MS),
    notes: null,
    trialEndDate: null,
    status: 'active',
    reminderDaysBefore: [1],
  });

  await service.trash({
    userId: 'user-1',
    subscriptionId: created.id,
  });

  nowValue += 13 * DAY_MS;
  assert.equal(await service.purgeExpiredTrash({ userId: 'user-1' }), 0);

  nowValue += 2 * DAY_MS;
  assert.equal(await service.purgeExpiredTrash({ userId: 'user-1' }), 1);
});
