import { randomUUID } from 'node:crypto';

import type { DbQueryClient } from '../../auth/contracts.js';
import { pool } from '../../db/pool.js';

export type MergeNoteRecord = Readonly<{
  id: string;
  userId: string;
  title: string | null;
  content: string | null;
  contentType: string | null;
  color: string | null;
  active: boolean;
  done: boolean | null;
  isPinned: boolean | null;
  triggerAt: Date | null;
  repeatRule: string | null;
  repeatConfig: Record<string, unknown> | null;
  repeat: Record<string, unknown> | null;
  snoozedUntil: Date | null;
  scheduleStatus: string | null;
  timezone: string | null;
  baseAtLocal: string | null;
  startAt: Date | null;
  nextTriggerAt: Date | null;
  lastFiredAt: Date | null;
  lastAcknowledgedAt: Date | null;
  version: number | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type MergeSubscriptionRecord = Readonly<{
  id: string;
  userId: string;
  serviceName: string;
  category: string;
  price: number;
  currency: string;
  billingCycle: string;
  billingCycleCustomDays: number | null;
  nextBillingDate: Date;
  notes: string | null;
  trialEndDate: Date | null;
  status: string;
  reminderDaysBefore: unknown;
  nextReminderAt: Date | null;
  lastNotifiedBillingDate: Date | null;
  nextTrialReminderAt: Date | null;
  lastNotifiedTrialEndDate: Date | null;
  active: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type MergeTokenRecord = Readonly<{
  id: string;
  userId: string;
  deviceId: string;
  fcmToken: string;
  platform: string;
  updatedAt: Date;
  createdAt: Date;
}>;

export type MergeEventRecord = Readonly<{
  id: string;
  noteId: string;
  userId: string;
  operation: string;
  changedAt: Date;
  deviceId: string;
  payloadHash: string;
}>;

export type MergeSnapshot = Readonly<{
  notes: ReadonlyArray<MergeNoteRecord>;
  subscriptions: ReadonlyArray<MergeSubscriptionRecord>;
  tokens: ReadonlyArray<MergeTokenRecord>;
  events: ReadonlyArray<MergeEventRecord>;
}>;

export type MergeUserRecord = Readonly<{
  id: string;
  username: string;
  passwordHash: string;
}>;

export type MigrationAttemptRecord = Readonly<{
  id: string;
  key: string;
  attempts: number;
  lastAttemptAt: Date | null;
  blockedUntil: Date | null;
}>;

type DbTransactionClient = DbQueryClient &
  Readonly<{
    release: () => void;
  }>;

type TransactionCapableDb = DbQueryClient &
  Readonly<{
    connect: () => Promise<DbTransactionClient>;
  }>;

export type MergeRepositoryTransaction = Readonly<{
  lockMigrationAttemptByKey: (key: string) => Promise<MigrationAttemptRecord>;
  updateMigrationAttempt: (
    input: Readonly<{ key: string; attempts: number; blockedUntil: Date | null }>,
  ) => Promise<MigrationAttemptRecord>;
  lockTargetUserById: (userId: string) => Promise<MergeUserRecord | null>;
  readSnapshotForUser: (userId: string) => Promise<MergeSnapshot>;
  replaceTargetWithSource: (
    input: Readonly<{ sourceUserId: string; targetUserId: string }>,
  ) => Promise<void>;
  mergeSourceIntoTarget: (
    input: Readonly<{
      source: MergeSnapshot;
      target: MergeSnapshot;
      sourceUserId: string;
      targetUserId: string;
      conflictingNoteIds: ReadonlySet<string>;
    }>,
  ) => Promise<void>;
}>;

export type MergeRepository = Readonly<{
  withTransaction: <T>(
    operation: (transaction: MergeRepositoryTransaction) => Promise<T>,
  ) => Promise<T>;
}>;

type MergeAttemptRow = Readonly<{
  id: string;
  key: string;
  attempts: number;
  last_attempt_at: Date | null;
  blocked_until: Date | null;
}>;

type MergeUserRow = Readonly<{
  id: string;
  username: string;
  password_hash: string;
}>;

type MergeNoteRow = Readonly<{
  id: string;
  user_id: string;
  title: string | null;
  content: string | null;
  content_type: string | null;
  color: string | null;
  active: boolean;
  done: boolean | null;
  is_pinned: boolean | null;
  trigger_at: Date | null;
  repeat_rule: string | null;
  repeat_config: Record<string, unknown> | null;
  repeat: Record<string, unknown> | null;
  snoozed_until: Date | null;
  schedule_status: string | null;
  timezone: string | null;
  base_at_local: string | null;
  start_at: Date | null;
  next_trigger_at: Date | null;
  last_fired_at: Date | null;
  last_acknowledged_at: Date | null;
  version: number | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}>;

type MergeSubscriptionRow = Readonly<{
  id: string;
  user_id: string;
  service_name: string;
  category: string;
  price: number;
  currency: string;
  billing_cycle: string;
  billing_cycle_custom_days: number | null;
  next_billing_date: Date;
  notes: string | null;
  trial_end_date: Date | null;
  status: string;
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

type MergeTokenRow = Readonly<{
  id: string;
  user_id: string;
  device_id: string;
  fcm_token: string;
  platform: string;
  updated_at: Date;
  created_at: Date;
}>;

type MergeEventRow = Readonly<{
  id: string;
  note_id: string;
  user_id: string;
  operation: string;
  changed_at: Date;
  device_id: string;
  payload_hash: string;
}>;

const toAttemptRecord = (row: MergeAttemptRow): MigrationAttemptRecord => {
  return {
    id: row.id,
    key: row.key,
    attempts: row.attempts,
    lastAttemptAt: row.last_attempt_at,
    blockedUntil: row.blocked_until,
  };
};

const toUserRecord = (row: MergeUserRow): MergeUserRecord => {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
  };
};

const toNoteRecord = (row: MergeNoteRow): MergeNoteRecord => {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    content: row.content,
    contentType: row.content_type,
    color: row.color,
    active: row.active,
    done: row.done,
    isPinned: row.is_pinned,
    triggerAt: row.trigger_at,
    repeatRule: row.repeat_rule,
    repeatConfig: row.repeat_config,
    repeat: row.repeat,
    snoozedUntil: row.snoozed_until,
    scheduleStatus: row.schedule_status,
    timezone: row.timezone,
    baseAtLocal: row.base_at_local,
    startAt: row.start_at,
    nextTriggerAt: row.next_trigger_at,
    lastFiredAt: row.last_fired_at,
    lastAcknowledgedAt: row.last_acknowledged_at,
    version: row.version,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toSubscriptionRecord = (row: MergeSubscriptionRow): MergeSubscriptionRecord => {
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
    reminderDaysBefore: row.reminder_days_before,
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

const toTokenRecord = (row: MergeTokenRow): MergeTokenRecord => {
  return {
    id: row.id,
    userId: row.user_id,
    deviceId: row.device_id,
    fcmToken: row.fcm_token,
    platform: row.platform,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
};

const toEventRecord = (row: MergeEventRow): MergeEventRecord => {
  return {
    id: row.id,
    noteId: row.note_id,
    userId: row.user_id,
    operation: row.operation,
    changedAt: row.changed_at,
    deviceId: row.device_id,
    payloadHash: row.payload_hash,
  };
};

const readSnapshot = async (db: DbQueryClient, userId: string): Promise<MergeSnapshot> => {
  const [notes, subscriptions, tokens, events] = await Promise.all([
    db.query<MergeNoteRow>(
      `
        SELECT *
        FROM notes
        WHERE user_id = $1
        ORDER BY updated_at ASC
      `,
      [userId],
    ),
    db.query<MergeSubscriptionRow>(
      `
        SELECT *
        FROM subscriptions
        WHERE user_id = $1
        ORDER BY updated_at ASC
      `,
      [userId],
    ),
    db.query<MergeTokenRow>(
      `
        SELECT *
        FROM device_push_tokens
        WHERE user_id = $1
        ORDER BY updated_at ASC
      `,
      [userId],
    ),
    db.query<MergeEventRow>(
      `
        SELECT *
        FROM note_change_events
        WHERE user_id = $1
        ORDER BY changed_at ASC
      `,
      [userId],
    ),
  ]);

  return {
    notes: notes.rows.map(toNoteRecord),
    subscriptions: subscriptions.rows.map(toSubscriptionRecord),
    tokens: tokens.rows.map(toTokenRecord),
    events: events.rows.map(toEventRecord),
  };
};

const createTransactionApi = (db: DbQueryClient): MergeRepositoryTransaction => {
  return {
    lockMigrationAttemptByKey: async (key) => {
      await db.query(
        `
          INSERT INTO migration_attempts (id, key, attempts, last_attempt_at, blocked_until)
          VALUES ($1, $2, 0, NOW(), NULL)
          ON CONFLICT (key) DO NOTHING
        `,
        [randomUUID(), key],
      );

      const locked = await db.query<MergeAttemptRow>(
        `
          SELECT *
          FROM migration_attempts
          WHERE key = $1
          FOR UPDATE
          LIMIT 1
        `,
        [key],
      );

      return toAttemptRecord(locked.rows[0]);
    },

    updateMigrationAttempt: async ({ key, attempts, blockedUntil }) => {
      const updated = await db.query<MergeAttemptRow>(
        `
          UPDATE migration_attempts
          SET attempts = $1,
              blocked_until = $2,
              last_attempt_at = NOW()
          WHERE key = $3
          RETURNING *
        `,
        [attempts, blockedUntil, key],
      );

      return toAttemptRecord(updated.rows[0]);
    },

    lockTargetUserById: async (userId) => {
      const result = await db.query<MergeUserRow>(
        `
          SELECT id, username, password_hash
          FROM users
          WHERE id = $1
          FOR UPDATE
          LIMIT 1
        `,
        [userId],
      );

      if (result.rows.length === 0) {
        return null;
      }

      return toUserRecord(result.rows[0]);
    },

    readSnapshotForUser: async (userId) => {
      return await readSnapshot(db, userId);
    },

    replaceTargetWithSource: async ({ sourceUserId, targetUserId }) => {
      await db.query('DELETE FROM device_push_tokens WHERE user_id = $1', [targetUserId]);
      await db.query('DELETE FROM subscriptions WHERE user_id = $1', [targetUserId]);
      await db.query('DELETE FROM notes WHERE user_id = $1', [targetUserId]);

      await db.query('UPDATE notes SET user_id = $1 WHERE user_id = $2', [
        targetUserId,
        sourceUserId,
      ]);
      await db.query('UPDATE subscriptions SET user_id = $1 WHERE user_id = $2', [
        targetUserId,
        sourceUserId,
      ]);
      await db.query('UPDATE device_push_tokens SET user_id = $1 WHERE user_id = $2', [
        targetUserId,
        sourceUserId,
      ]);
      await db.query('UPDATE note_change_events SET user_id = $1 WHERE user_id = $2', [
        targetUserId,
        sourceUserId,
      ]);
    },

    mergeSourceIntoTarget: async ({
      source,
      target,
      sourceUserId,
      targetUserId,
      conflictingNoteIds,
    }) => {
      const targetNoteIds = new Set(target.notes.map((note) => note.id));
      const movedNoteIds: string[] = [];
      const conflictCopies = new Map<string, string>();

      for (const sourceNote of source.notes) {
        if (!targetNoteIds.has(sourceNote.id)) {
          await db.query('UPDATE notes SET user_id = $1 WHERE id = $2', [
            targetUserId,
            sourceNote.id,
          ]);
          movedNoteIds.push(sourceNote.id);
          continue;
        }

        if (!conflictingNoteIds.has(sourceNote.id)) {
          continue;
        }

        const copyId = randomUUID();
        conflictCopies.set(sourceNote.id, copyId);
        const copiedTitle = sourceNote.title ? `${sourceNote.title} (Local copy)` : 'Local copy';

        await db.query(
          `
            INSERT INTO notes (
              id,
              user_id,
              title,
              content,
              content_type,
              color,
              active,
              done,
              is_pinned,
              trigger_at,
              repeat_rule,
              repeat_config,
              repeat,
              snoozed_until,
              schedule_status,
              timezone,
              base_at_local,
              start_at,
              next_trigger_at,
              last_fired_at,
              last_acknowledged_at,
              version,
              deleted_at,
              created_at,
              updated_at
            )
            VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
              $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
              $21,$22,$23,$24,$25
            )
          `,
          [
            copyId,
            targetUserId,
            copiedTitle,
            sourceNote.content,
            sourceNote.contentType,
            sourceNote.color,
            sourceNote.active,
            sourceNote.done,
            sourceNote.isPinned,
            sourceNote.triggerAt,
            sourceNote.repeatRule,
            sourceNote.repeatConfig,
            sourceNote.repeat,
            sourceNote.snoozedUntil,
            sourceNote.scheduleStatus,
            sourceNote.timezone,
            sourceNote.baseAtLocal,
            sourceNote.startAt,
            sourceNote.nextTriggerAt,
            sourceNote.lastFiredAt,
            sourceNote.lastAcknowledgedAt,
            sourceNote.version ?? 1,
            sourceNote.deletedAt,
            sourceNote.createdAt,
            sourceNote.updatedAt,
          ],
        );
      }

      if (movedNoteIds.length > 0) {
        await db.query(
          `
            UPDATE note_change_events
            SET user_id = $1
            WHERE user_id = $2
              AND note_id = ANY($3::text[])
          `,
          [targetUserId, sourceUserId, movedNoteIds],
        );
      }

      await db.query('UPDATE subscriptions SET user_id = $1 WHERE user_id = $2', [
        targetUserId,
        sourceUserId,
      ]);
      await db.query('UPDATE device_push_tokens SET user_id = $1 WHERE user_id = $2', [
        targetUserId,
        sourceUserId,
      ]);

      if (conflictCopies.size > 0) {
        for (const sourceEvent of source.events) {
          const copiedNoteId = conflictCopies.get(sourceEvent.noteId);
          if (!copiedNoteId) {
            continue;
          }

          await db.query(
            `
              INSERT INTO note_change_events (id, note_id, user_id, operation, changed_at, device_id, payload_hash)
              VALUES ($1, $2, $3, $4, $5, $6, $7)
              ON CONFLICT (note_id, user_id, operation, payload_hash) DO NOTHING
            `,
            [
              randomUUID(),
              copiedNoteId,
              targetUserId,
              sourceEvent.operation,
              sourceEvent.changedAt,
              sourceEvent.deviceId,
              sourceEvent.payloadHash,
            ],
          );
        }
      }
    },
  };
};

export const createMergeRepository = (
  deps: Readonly<{ db?: TransactionCapableDb }> = {},
): MergeRepository => {
  const db = deps.db ?? (pool as TransactionCapableDb);

  return {
    withTransaction: async (operation) => {
      const client = await db.connect();

      try {
        await client.query('BEGIN');
        const transaction = createTransactionApi(client);
        const result = await operation(transaction);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
};
