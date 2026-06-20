import { randomUUID } from 'node:crypto';

import type { DbQueryClient } from '../../auth/contracts.js';
import { pool } from '../../db/pool.js';
import type { ReminderDeliveryStatus } from '../contracts.js';

export type ReminderDeliveryRecord = Readonly<{
  id: string;
  reminderId: string;
  userId: string;
  occurrenceAt: Date;
  reminderVersion: number;
  deliveryKey: string;
  status: ReminderDeliveryStatus;
  providerMessageId: string | null;
  attemptCount: number;
  createdAt: Date;
  sentAt: Date | null;
  failureReason: string | null;
}>;

type ReminderDeliveryRow = Readonly<{
  id: string;
  reminder_id: string;
  user_id: string;
  occurrence_at: Date;
  reminder_version: number;
  delivery_key: string;
  status: ReminderDeliveryStatus;
  provider_message_id: string | null;
  attempt_count: number;
  created_at: Date;
  sent_at: Date | null;
  failure_reason: string | null;
  inserted?: boolean;
}>;

const toDomain = (row: ReminderDeliveryRow): ReminderDeliveryRecord => ({
  id: row.id,
  reminderId: row.reminder_id,
  userId: row.user_id,
  occurrenceAt: row.occurrence_at,
  reminderVersion: row.reminder_version,
  deliveryKey: row.delivery_key,
  status: row.status,
  providerMessageId: row.provider_message_id,
  attemptCount: row.attempt_count,
  createdAt: row.created_at,
  sentAt: row.sent_at,
  failureReason: row.failure_reason,
});

export type ReminderDeliveriesRepository = Readonly<{
  insertPending: (
    input: Readonly<{
      reminderId: string;
      userId: string;
      occurrenceAt: Date;
      reminderVersion: number;
      deliveryKey: string;
    }>,
  ) => Promise<Readonly<{ inserted: boolean; delivery: ReminderDeliveryRecord }>>;
  markSent: (input: Readonly<{ deliveryKey: string; providerMessageId?: string }>) => Promise<void>;
  markFailed: (input: Readonly<{ deliveryKey: string; reason: string }>) => Promise<void>;
  markCanceled: (
    input: Readonly<{
      deliveryKey: string;
      reminderId: string;
      userId: string;
      occurrenceAt: Date;
      reminderVersion: number;
      reason: string;
    }>,
  ) => Promise<void>;
  markStale: (
    input: Readonly<{
      deliveryKey: string;
      reminderId: string;
      userId: string;
      occurrenceAt: Date;
      reminderVersion: number;
      reason: string;
    }>,
  ) => Promise<void>;
}>;

export const createReminderDeliveriesRepository = (
  deps: Readonly<{ db?: DbQueryClient; createId?: () => string; now?: () => Date }> = {},
): ReminderDeliveriesRepository => {
  const db = deps.db ?? pool;
  const createId = deps.createId ?? randomUUID;
  const now = deps.now ?? (() => new Date());

  const upsertTerminal = async (
    input: Readonly<{
      status: 'stale' | 'canceled';
      deliveryKey: string;
      reminderId: string;
      userId: string;
      occurrenceAt: Date;
      reminderVersion: number;
      reason: string;
    }>,
  ): Promise<void> => {
    await db.query(
      `
        -- terminal delivery status uses bound values such as stale or canceled
        INSERT INTO reminder_deliveries (
          id, reminder_id, user_id, occurrence_at, reminder_version,
          delivery_key, status, attempt_count, created_at, failure_reason
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9)
        ON CONFLICT (delivery_key)
        DO UPDATE SET
          status = EXCLUDED.status,
          failure_reason = EXCLUDED.failure_reason
      `,
      [
        createId(),
        input.reminderId,
        input.userId,
        input.occurrenceAt,
        input.reminderVersion,
        input.deliveryKey,
        input.status,
        now(),
        input.reason,
      ],
    );
  };

  return {
    insertPending: async (input) => {
      const result = await db.query<ReminderDeliveryRow>(
        `
          WITH inserted AS (
            INSERT INTO reminder_deliveries (
              id, reminder_id, user_id, occurrence_at, reminder_version,
              delivery_key, status, attempt_count, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, 'pending', 0, $7)
            ON CONFLICT (reminder_id, occurrence_at) DO NOTHING
            RETURNING *, true AS inserted
          )
          SELECT * FROM inserted
          UNION ALL
          SELECT *, false AS inserted
          FROM reminder_deliveries
          WHERE reminder_id = $2 AND occurrence_at = $4
          LIMIT 1
        `,
        [
          createId(),
          input.reminderId,
          input.userId,
          input.occurrenceAt,
          input.reminderVersion,
          input.deliveryKey,
          now(),
        ],
      );

      const row = result.rows[0];
      if (row === undefined) {
        throw new Error(`Reminder delivery row missing for ${input.deliveryKey}`);
      }

      return {
        inserted: row.inserted === true,
        delivery: toDomain(row),
      };
    },
    markSent: async ({ deliveryKey, providerMessageId }) => {
      await db.query(
        `
          UPDATE reminder_deliveries
          SET status = 'sent',
              provider_message_id = $1,
              sent_at = $2,
              attempt_count = attempt_count + 1,
              failure_reason = NULL
          WHERE delivery_key = $3
        `,
        [providerMessageId ?? null, now(), deliveryKey],
      );
    },
    markFailed: async ({ deliveryKey, reason }) => {
      await db.query(
        `
          UPDATE reminder_deliveries
          SET status = 'failed',
              attempt_count = attempt_count + 1,
              failure_reason = $1
          WHERE delivery_key = $2
        `,
        [reason, deliveryKey],
      );
    },
    markCanceled: async (input) => {
      await upsertTerminal({ ...input, status: 'canceled' });
    },
    markStale: async (input) => {
      await upsertTerminal({ ...input, status: 'stale' });
    },
  };
};
