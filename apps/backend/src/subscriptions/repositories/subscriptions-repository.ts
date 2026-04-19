import type { DbQueryClient } from '../../auth/contracts.js';
import { pool } from '../../db/pool.js';
import type {
  SubscriptionCreateInput,
  SubscriptionRecord,
  SubscriptionUpdatePatch,
} from '../contracts.js';

type SubscriptionRow = Readonly<{
  id: string;
  user_id: string;
  service_name: string;
  category: string;
  price: number;
  currency: string;
  billing_cycle: 'weekly' | 'monthly' | 'yearly' | 'custom';
  billing_cycle_custom_days: number | null;
  next_billing_date: Date;
  notes: string | null;
  trial_end_date: Date | null;
  status: 'active' | 'paused' | 'canceled';
  reminder_days_before: unknown;
  next_reminder_at: Date | null;
  last_notified_billing_date: Date | null;
  next_trial_reminder_at: Date | null;
  last_notified_trial_end_date: Date | null;
  active: boolean;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}>;

export type SubscriptionsRepository = Readonly<{
  listByUser: (userId: string) => Promise<ReadonlyArray<SubscriptionRecord>>;
  listTrashedByUser: (userId: string) => Promise<ReadonlyArray<SubscriptionRecord>>;
  findByIdForUser: (
    input: Readonly<{ subscriptionId: string; userId: string }>,
  ) => Promise<SubscriptionRecord | null>;
  create: (input: SubscriptionCreateInput) => Promise<SubscriptionRecord>;
  patch: (
    input: Readonly<{ subscriptionId: string; userId: string; patch: SubscriptionUpdatePatch }>,
  ) => Promise<SubscriptionRecord | null>;
  hardDelete: (input: Readonly<{ subscriptionId: string; userId: string }>) => Promise<boolean>;
}>;

const toReminderDaysBefore = (value: unknown): ReadonlyArray<number> => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry >= 0)
    .sort((a, b) => a - b);
};

const toDomain = (row: SubscriptionRow): SubscriptionRecord => {
  return {
    id: row.id,
    userId: row.user_id,
    serviceName: row.service_name,
    category: row.category,
    price: row.price,
    currency: row.currency,
    billingCycle: row.billing_cycle,
    billingCycleCustomDays: row.billing_cycle_custom_days,
    nextBillingDate: row.next_billing_date,
    notes: row.notes,
    trialEndDate: row.trial_end_date,
    status: row.status,
    reminderDaysBefore: toReminderDaysBefore(row.reminder_days_before),
    nextReminderAt: row.next_reminder_at,
    lastNotifiedBillingDate: row.last_notified_billing_date,
    nextTrialReminderAt: row.next_trial_reminder_at,
    lastNotifiedTrialEndDate: row.last_notified_trial_end_date,
    active: row.active,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toPatchColumns = (
  patch: SubscriptionUpdatePatch,
): Array<Readonly<{ column: string; value: unknown }>> => {
  const columns: Array<Readonly<{ column: string; value: unknown }>> = [];
  const add = (column: string, value: unknown): void => {
    columns.push({ column, value });
  };

  if (Object.hasOwn(patch, 'serviceName')) add('service_name', patch.serviceName ?? null);
  if (Object.hasOwn(patch, 'category')) add('category', patch.category ?? null);
  if (Object.hasOwn(patch, 'price')) add('price', patch.price ?? 0);
  if (Object.hasOwn(patch, 'currency')) add('currency', patch.currency ?? null);
  if (Object.hasOwn(patch, 'billingCycle')) add('billing_cycle', patch.billingCycle ?? null);
  if (Object.hasOwn(patch, 'billingCycleCustomDays'))
    add('billing_cycle_custom_days', patch.billingCycleCustomDays ?? null);
  if (Object.hasOwn(patch, 'nextBillingDate'))
    add('next_billing_date', patch.nextBillingDate ?? null);
  if (Object.hasOwn(patch, 'notes')) add('notes', patch.notes ?? null);
  if (Object.hasOwn(patch, 'trialEndDate')) add('trial_end_date', patch.trialEndDate ?? null);
  if (Object.hasOwn(patch, 'status')) add('status', patch.status ?? null);
  if (Object.hasOwn(patch, 'reminderDaysBefore'))
    add('reminder_days_before', patch.reminderDaysBefore ?? []);
  if (Object.hasOwn(patch, 'nextReminderAt')) add('next_reminder_at', patch.nextReminderAt ?? null);
  if (Object.hasOwn(patch, 'nextTrialReminderAt'))
    add('next_trial_reminder_at', patch.nextTrialReminderAt ?? null);
  if (Object.hasOwn(patch, 'deletedAt')) add('deleted_at', patch.deletedAt ?? null);
  if (Object.hasOwn(patch, 'active')) add('active', patch.active ?? true);
  if (Object.hasOwn(patch, 'updatedAt')) add('updated_at', patch.updatedAt ?? new Date());

  return columns;
};

export const createSubscriptionsRepository = (
  deps: Readonly<{ db?: DbQueryClient }> = {},
): SubscriptionsRepository => {
  const db = deps.db ?? pool;

  const findByIdForUser = async (
    input: Readonly<{ subscriptionId: string; userId: string }>,
  ): Promise<SubscriptionRecord | null> => {
    const result = await db.query<SubscriptionRow>(
      `
        SELECT *
        FROM subscriptions
        WHERE id = $1 AND user_id = $2
        LIMIT 1
      `,
      [input.subscriptionId, input.userId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return toDomain(result.rows[0]);
  };

  return {
    listByUser: async (userId) => {
      const result = await db.query<SubscriptionRow>(
        `
          SELECT *
          FROM subscriptions
          WHERE user_id = $1 AND active = true
          ORDER BY updated_at DESC
        `,
        [userId],
      );

      return result.rows.map(toDomain);
    },

    listTrashedByUser: async (userId) => {
      const result = await db.query<SubscriptionRow>(
        `
          SELECT *
          FROM subscriptions
          WHERE user_id = $1 AND active = false
          ORDER BY deleted_at DESC NULLS LAST
        `,
        [userId],
      );

      return result.rows.map(toDomain);
    },

    findByIdForUser,

    create: async (input) => {
      const result = await db.query<SubscriptionRow>(
        `
          INSERT INTO subscriptions (
            id,
            user_id,
            service_name,
            category,
            price,
            currency,
            billing_cycle,
            billing_cycle_custom_days,
            next_billing_date,
            notes,
            trial_end_date,
            status,
            reminder_days_before,
            active,
            created_at,
            updated_at
          )
          VALUES (
            gen_random_uuid()::text,
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12,
            true,
            NOW(),
            NOW()
          )
          RETURNING *
        `,
        [
          input.userId,
          input.serviceName,
          input.category,
          input.price,
          input.currency,
          input.billingCycle,
          input.billingCycleCustomDays,
          input.nextBillingDate,
          input.notes,
          input.trialEndDate,
          input.status,
          input.reminderDaysBefore,
        ],
      );

      return toDomain(result.rows[0]);
    },

    patch: async ({ subscriptionId, userId, patch }) => {
      const columns = toPatchColumns(patch);
      if (columns.length === 0) {
        return await findByIdForUser({ subscriptionId, userId });
      }

      const setClause = columns.map((entry, index) => `${entry.column} = $${index + 1}`).join(', ');
      const values = columns.map((entry) => entry.value);
      values.push(subscriptionId, userId);

      const result = await db.query<SubscriptionRow>(
        `
          UPDATE subscriptions
          SET ${setClause}
          WHERE id = $${columns.length + 1} AND user_id = $${columns.length + 2}
          RETURNING *
        `,
        values,
      );

      if (result.rows.length === 0) {
        return null;
      }

      return toDomain(result.rows[0]);
    },

    hardDelete: async ({ subscriptionId, userId }) => {
      const result = await db.query<{ id: string }>(
        `
          DELETE FROM subscriptions
          WHERE id = $1 AND user_id = $2
          RETURNING id
        `,
        [subscriptionId, userId],
      );

      return result.rows.length > 0;
    },
  };
};
