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

export type MergeExpenseSettingsRecord = Readonly<{
  userId: string;
  defaultSchema: Record<string, unknown>;
  seedRows: unknown;
  updatedAt: Date;
}>;

export type MergeExpensePeriodRecord = Readonly<{
  id: string;
  userId: string;
  year: number;
  month: number;
  schema: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}>;

export type MergeExpenseRowRecord = Readonly<{
  id: string;
  periodId: string;
  userId: string;
  position: number;
  cells: Record<string, unknown>;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type MergeSnapshot = Readonly<{
  notes: ReadonlyArray<MergeNoteRecord>;
  subscriptions: ReadonlyArray<MergeSubscriptionRecord>;
  tokens: ReadonlyArray<MergeTokenRecord>;
  events: ReadonlyArray<MergeEventRecord>;
  expenseSettings: MergeExpenseSettingsRecord | null;
  expensePeriods: ReadonlyArray<MergeExpensePeriodRecord>;
  expenseRows: ReadonlyArray<MergeExpenseRowRecord>;
}>;

export const expensePeriodMonthKey = (period: Readonly<{ year: number; month: number }>): string =>
  `${period.year}-${period.month}`;

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

type MergeExpenseSettingsRow = Readonly<{
  user_id: string;
  default_schema: Record<string, unknown>;
  seed_rows: unknown;
  updated_at: Date;
}>;

type MergeExpensePeriodRow = Readonly<{
  id: string;
  user_id: string;
  year: number;
  month: number;
  schema: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}>;

type MergeExpenseRowRow = Readonly<{
  id: string;
  period_id: string;
  user_id: string;
  position: number;
  cells: Record<string, unknown>;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
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

const toExpenseSettingsRecord = (
  row: MergeExpenseSettingsRow,
): MergeExpenseSettingsRecord => {
  return {
    userId: row.user_id,
    defaultSchema: row.default_schema,
    seedRows: row.seed_rows,
    updatedAt: row.updated_at,
  };
};

const toExpensePeriodRecord = (row: MergeExpensePeriodRow): MergeExpensePeriodRecord => {
  return {
    id: row.id,
    userId: row.user_id,
    year: row.year,
    month: row.month,
    schema: row.schema,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toExpenseRowRecord = (row: MergeExpenseRowRow): MergeExpenseRowRecord => {
  return {
    id: row.id,
    periodId: row.period_id,
    userId: row.user_id,
    position: row.position,
    cells: row.cells,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const deleteTargetExpenseData = async (
  db: DbQueryClient,
  targetUserId: string,
): Promise<void> => {
  await db.query('DELETE FROM expense_rows WHERE user_id = $1', [targetUserId]);
  await db.query('DELETE FROM expense_periods WHERE user_id = $1', [targetUserId]);
  await db.query('DELETE FROM expense_user_settings WHERE user_id = $1', [targetUserId]);
};

const moveAllSourceExpensesToTarget = async (
  db: DbQueryClient,
  sourceUserId: string,
  targetUserId: string,
): Promise<void> => {
  await db.query('UPDATE expense_periods SET user_id = $1 WHERE user_id = $2', [
    targetUserId,
    sourceUserId,
  ]);
  await db.query('UPDATE expense_rows SET user_id = $1 WHERE user_id = $2', [
    targetUserId,
    sourceUserId,
  ]);

  const sourceSettings = await db.query<MergeExpenseSettingsRow>(
    `
      SELECT *
      FROM expense_user_settings
      WHERE user_id = $1
      LIMIT 1
    `,
    [sourceUserId],
  );

  if (sourceSettings.rows.length === 0) {
    return;
  }

  const settings = sourceSettings.rows[0];
  await db.query(
    `
      INSERT INTO expense_user_settings (user_id, default_schema, seed_rows, updated_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id) DO UPDATE
      SET default_schema = EXCLUDED.default_schema,
          seed_rows = EXCLUDED.seed_rows,
          updated_at = EXCLUDED.updated_at
    `,
    [targetUserId, settings.default_schema, settings.seed_rows, settings.updated_at],
  );
  await db.query('DELETE FROM expense_user_settings WHERE user_id = $1', [sourceUserId]);
};

const mergeExpenseRowsIntoTargetPeriod = async (
  db: DbQueryClient,
  input: Readonly<{
    sourcePeriodId: string;
    targetPeriodId: string;
    targetUserId: string;
  }>,
): Promise<void> => {
  const maxPositionResult = await db.query<{ max_position: number | null }>(
    `
      SELECT MAX(position) AS max_position
      FROM expense_rows
      WHERE period_id = $1
    `,
    [input.targetPeriodId],
  );

  const maxPosition = maxPositionResult.rows[0]?.max_position ?? -1;

  await db.query(
    `
      WITH ordered_source_rows AS (
        SELECT
          id,
          ROW_NUMBER() OVER (ORDER BY position ASC, created_at ASC) - 1 AS row_offset
        FROM expense_rows
        WHERE period_id = $1
      )
      UPDATE expense_rows AS rows
      SET period_id = $2,
          user_id = $3,
          position = $4 + ordered_source_rows.row_offset
      FROM ordered_source_rows
      WHERE rows.id = ordered_source_rows.id
    `,
    [input.sourcePeriodId, input.targetPeriodId, input.targetUserId, maxPosition + 1],
  );
};

const mergeSourceExpensesIntoTarget = async (
  db: DbQueryClient,
  input: Readonly<{
    source: MergeSnapshot;
    target: MergeSnapshot;
    sourceUserId: string;
    targetUserId: string;
  }>,
): Promise<void> => {
  const targetPeriodByMonth = new Map(
    input.target.expensePeriods.map((period) => [expensePeriodMonthKey(period), period]),
  );

  for (const sourcePeriod of input.source.expensePeriods) {
    const monthKey = expensePeriodMonthKey(sourcePeriod);
    const targetPeriod = targetPeriodByMonth.get(monthKey);

    if (!targetPeriod) {
      await db.query('UPDATE expense_periods SET user_id = $1 WHERE id = $2', [
        input.targetUserId,
        sourcePeriod.id,
      ]);
      await db.query('UPDATE expense_rows SET user_id = $1 WHERE period_id = $2', [
        input.targetUserId,
        sourcePeriod.id,
      ]);
      continue;
    }

    await mergeExpenseRowsIntoTargetPeriod(db, {
      sourcePeriodId: sourcePeriod.id,
      targetPeriodId: targetPeriod.id,
      targetUserId: input.targetUserId,
    });
    await db.query('DELETE FROM expense_periods WHERE id = $1', [sourcePeriod.id]);
  }

  if (input.target.expenseSettings === null && input.source.expenseSettings !== null) {
    const settings = input.source.expenseSettings;
    await db.query(
      `
        INSERT INTO expense_user_settings (user_id, default_schema, seed_rows, updated_at)
        VALUES ($1, $2, $3, $4)
      `,
      [input.targetUserId, settings.defaultSchema, settings.seedRows, settings.updatedAt],
    );
    await db.query('DELETE FROM expense_user_settings WHERE user_id = $1', [input.sourceUserId]);
  }
};

const readSnapshot = async (db: DbQueryClient, userId: string): Promise<MergeSnapshot> => {
  const [notes, subscriptions, tokens, events, expenseSettings, expensePeriods, expenseRows] =
    await Promise.all([
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
      db.query<MergeExpenseSettingsRow>(
        `
          SELECT *
          FROM expense_user_settings
          WHERE user_id = $1
          LIMIT 1
        `,
        [userId],
      ),
      db.query<MergeExpensePeriodRow>(
        `
          SELECT *
          FROM expense_periods
          WHERE user_id = $1
          ORDER BY year DESC, month DESC
        `,
        [userId],
      ),
      db.query<MergeExpenseRowRow>(
        `
          SELECT *
          FROM expense_rows
          WHERE user_id = $1
          ORDER BY period_id ASC, position ASC
        `,
        [userId],
      ),
    ]);

  return {
    notes: notes.rows.map(toNoteRecord),
    subscriptions: subscriptions.rows.map(toSubscriptionRecord),
    tokens: tokens.rows.map(toTokenRecord),
    events: events.rows.map(toEventRecord),
    expenseSettings:
      expenseSettings.rows.length > 0
        ? toExpenseSettingsRecord(expenseSettings.rows[0])
        : null,
    expensePeriods: expensePeriods.rows.map(toExpensePeriodRecord),
    expenseRows: expenseRows.rows.map(toExpenseRowRecord),
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
      await deleteTargetExpenseData(db, targetUserId);
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
      await moveAllSourceExpensesToTarget(db, sourceUserId, targetUserId);
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

      await mergeSourceExpensesIntoTarget(db, {
        source,
        target,
        sourceUserId,
        targetUserId,
      });
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