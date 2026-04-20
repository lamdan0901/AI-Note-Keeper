import assert from 'node:assert/strict';
import test from 'node:test';

import type { DbQueryClient } from '../../auth/contracts.js';

type CapturedQuery = Readonly<{
  text: string;
  values: ReadonlyArray<unknown>;
}>;

const baseRow = {
  id: 'sub-1',
  user_id: 'user-1',
  service_name: 'Netflix',
  category: 'entertainment',
  price: 9.99,
  currency: 'USD',
  billing_cycle: 'monthly' as const,
  billing_cycle_custom_days: null,
  next_billing_date: new Date('2026-05-01T00:00:00.000Z'),
  notes: null,
  trial_end_date: null,
  status: 'active' as const,
  reminder_days_before: [1, 3],
  next_reminder_at: null,
  last_notified_billing_date: null,
  next_trial_reminder_at: null,
  last_notified_trial_end_date: null,
  active: true,
  deleted_at: null,
  created_at: new Date('2026-04-20T00:00:00.000Z'),
  updated_at: new Date('2026-04-20T00:00:00.000Z'),
};

const createCapturingDb = (): Readonly<{
  db: DbQueryClient;
  queries: Array<CapturedQuery>;
}> => {
  const queries: Array<CapturedQuery> = [];

  const db: DbQueryClient = {
    query: async <Row extends Record<string, unknown>>(
      text: string,
      values: ReadonlyArray<unknown> = [],
    ) => {
      queries.push({ text, values });

      const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();

      if (normalized.startsWith('insert into subscriptions')) {
        const reminderDaysBefore = JSON.parse(String(values[11]));
        return {
          rows: [
            { ...baseRow, reminder_days_before: reminderDaysBefore },
          ] as unknown as ReadonlyArray<Row>,
        };
      }

      if (normalized.startsWith('update subscriptions')) {
        const reminderDaysBefore = JSON.parse(String(values[0]));
        return {
          rows: [
            { ...baseRow, reminder_days_before: reminderDaysBefore },
          ] as unknown as ReadonlyArray<Row>,
        };
      }

      throw new Error(`Unsupported query in test adapter: ${text}`);
    },
  };

  return { db, queries };
};

const loadRepositoryFactory = async (): Promise<
  typeof import('../../subscriptions/repositories/subscriptions-repository.js').createSubscriptionsRepository
> => {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/ai_note_keeper';
  }

  const module = await import('../../subscriptions/repositories/subscriptions-repository.js');
  return module.createSubscriptionsRepository;
};

test('create serializes reminderDaysBefore to JSONB parameter', async () => {
  const { db, queries } = createCapturingDb();
  const createSubscriptionsRepository = await loadRepositoryFactory();
  const repo = createSubscriptionsRepository({ db });

  const created = await repo.create({
    userId: 'user-1',
    serviceName: 'Netflix',
    category: 'entertainment',
    price: 9.99,
    currency: 'USD',
    billingCycle: 'monthly',
    billingCycleCustomDays: null,
    nextBillingDate: new Date('2026-05-01T00:00:00.000Z'),
    notes: null,
    trialEndDate: null,
    status: 'active',
    reminderDaysBefore: [7, 1],
  });

  const insert = queries[0];
  assert.match(insert.text, /\$12::jsonb/i);
  assert.equal(insert.values[11], '[7,1]');
  assert.deepEqual(created.reminderDaysBefore, [1, 7]);
});

test('patch serializes reminderDaysBefore and casts update parameter to JSONB', async () => {
  const { db, queries } = createCapturingDb();
  const createSubscriptionsRepository = await loadRepositoryFactory();
  const repo = createSubscriptionsRepository({ db });

  const updated = await repo.patch({
    subscriptionId: 'sub-1',
    userId: 'user-1',
    patch: {
      reminderDaysBefore: [5, 2],
    },
  });

  assert.ok(updated);

  const update = queries[0];
  assert.match(update.text, /reminder_days_before\s*=\s*\$1::jsonb/i);
  assert.equal(update.values[0], '[5,2]');
  assert.deepEqual(updated?.reminderDaysBefore, [2, 5]);
});
