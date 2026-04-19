import type { DbQueryClient } from '../../auth/contracts.js';
import { pool } from '../../db/pool.js';
import type {
  ReminderCreateInput,
  ReminderPatchInput,
  ReminderRecord,
  ReminderRepeatRule,
} from '../contracts.js';

type ReminderRow = Readonly<{
  id: string;
  user_id: string;
  title: string | null;
  trigger_at: Date;
  done: boolean | null;
  repeat_rule: string | null;
  repeat_config: Record<string, unknown> | null;
  repeat: ReminderRepeatRule | null;
  snoozed_until: Date | null;
  active: boolean;
  schedule_status: string | null;
  timezone: string | null;
  base_at_local: string | null;
  start_at: Date | null;
  next_trigger_at: Date | null;
  last_fired_at: Date | null;
  last_acknowledged_at: Date | null;
  version: number | null;
  created_at: Date;
  updated_at: Date;
}>;

export type RemindersRepository = Readonly<{
  listByUser: (
    input: Readonly<{ userId: string; updatedSince?: Date }>,
  ) => Promise<ReminderRecord[]>;
  findByIdForUser: (
    input: Readonly<{ reminderId: string; userId: string }>,
  ) => Promise<ReminderRecord | null>;
  create: (input: ReminderCreateInput) => Promise<ReminderRecord>;
  patch: (
    input: Readonly<{ reminderId: string; userId: string; patch: ReminderPatchInput }>,
  ) => Promise<ReminderRecord | null>;
  deleteByIdForUser: (input: Readonly<{ reminderId: string; userId: string }>) => Promise<boolean>;
}>;

const toDomain = (row: ReminderRow): ReminderRecord => {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    triggerAt: row.trigger_at,
    done: row.done,
    repeatRule: row.repeat_rule,
    repeatConfig: row.repeat_config,
    repeat: row.repeat,
    snoozedUntil: row.snoozed_until,
    active: row.active,
    scheduleStatus: row.schedule_status ?? 'unscheduled',
    timezone: row.timezone ?? 'UTC',
    baseAtLocal: row.base_at_local,
    startAt: row.start_at,
    nextTriggerAt: row.next_trigger_at,
    lastFiredAt: row.last_fired_at,
    lastAcknowledgedAt: row.last_acknowledged_at,
    version: row.version ?? 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const INSERT_COLUMNS = [
  'id',
  'user_id',
  'title',
  'trigger_at',
  'done',
  'repeat_rule',
  'repeat_config',
  'repeat',
  'snoozed_until',
  'active',
  'schedule_status',
  'timezone',
  'base_at_local',
  'start_at',
  'next_trigger_at',
  'last_fired_at',
  'last_acknowledged_at',
  'version',
  'created_at',
  'updated_at',
] as const;

const patchToColumnValue = (
  patch: ReminderPatchInput,
): Array<Readonly<{ column: string; value: unknown }>> => {
  const pairs: Array<Readonly<{ column: string; value: unknown }>> = [];

  const add = (column: string, value: unknown): void => {
    pairs.push({ column, value });
  };

  if (Object.hasOwn(patch, 'title')) add('title', patch.title ?? null);
  if (Object.hasOwn(patch, 'triggerAt')) add('trigger_at', patch.triggerAt);
  if (Object.hasOwn(patch, 'done')) add('done', patch.done ?? null);
  if (Object.hasOwn(patch, 'repeatRule')) add('repeat_rule', patch.repeatRule ?? null);
  if (Object.hasOwn(patch, 'repeatConfig')) add('repeat_config', patch.repeatConfig ?? null);
  if (Object.hasOwn(patch, 'repeat')) add('repeat', patch.repeat ?? null);
  if (Object.hasOwn(patch, 'snoozedUntil')) add('snoozed_until', patch.snoozedUntil ?? null);
  if (Object.hasOwn(patch, 'active')) add('active', patch.active ?? true);
  if (Object.hasOwn(patch, 'scheduleStatus'))
    add('schedule_status', patch.scheduleStatus ?? 'unscheduled');
  if (Object.hasOwn(patch, 'timezone')) add('timezone', patch.timezone ?? 'UTC');
  if (Object.hasOwn(patch, 'baseAtLocal')) add('base_at_local', patch.baseAtLocal ?? null);
  if (Object.hasOwn(patch, 'startAt')) add('start_at', patch.startAt ?? null);
  if (Object.hasOwn(patch, 'nextTriggerAt')) add('next_trigger_at', patch.nextTriggerAt ?? null);
  if (Object.hasOwn(patch, 'lastFiredAt')) add('last_fired_at', patch.lastFiredAt ?? null);
  if (Object.hasOwn(patch, 'lastAcknowledgedAt'))
    add('last_acknowledged_at', patch.lastAcknowledgedAt ?? null);
  if (Object.hasOwn(patch, 'version')) add('version', patch.version ?? 1);
  if (Object.hasOwn(patch, 'updatedAt')) add('updated_at', patch.updatedAt ?? new Date());

  return pairs;
};

const findByIdAndUser = async (
  db: DbQueryClient,
  input: Readonly<{ reminderId: string; userId: string }>,
): Promise<ReminderRecord | null> => {
  const result = await db.query<ReminderRow>(
    `
      SELECT *
      FROM notes
      WHERE id = $1
        AND user_id = $2
        AND trigger_at IS NOT NULL
      LIMIT 1
    `,
    [input.reminderId, input.userId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return toDomain(result.rows[0]);
};

export const createRemindersRepository = (
  deps: Readonly<{ db?: DbQueryClient }> = {},
): RemindersRepository => {
  const db = deps.db ?? pool;

  return {
    listByUser: async ({ userId, updatedSince }) => {
      const values: unknown[] = [userId];
      const updatedSinceClause = updatedSince
        ? (() => {
            values.push(updatedSince);
            return 'AND updated_at > $2';
          })()
        : '';

      const result = await db.query<ReminderRow>(
        `
          SELECT *
          FROM notes
          WHERE user_id = $1
            AND trigger_at IS NOT NULL
            ${updatedSinceClause}
          ORDER BY updated_at DESC
        `,
        values,
      );

      return result.rows.map(toDomain);
    },

    findByIdForUser: async ({ reminderId, userId }) => {
      return await findByIdAndUser(db, { reminderId, userId });
    },

    create: async (input) => {
      const values = [
        input.id,
        input.userId,
        input.title,
        input.triggerAt,
        input.done,
        input.repeatRule,
        input.repeatConfig,
        input.repeat,
        input.snoozedUntil,
        input.active,
        input.scheduleStatus,
        input.timezone,
        input.baseAtLocal,
        input.startAt,
        input.nextTriggerAt,
        input.lastFiredAt,
        input.lastAcknowledgedAt,
        input.version,
        input.createdAt,
        input.updatedAt,
      ];

      const placeholders = INSERT_COLUMNS.map((_, index) => `$${index + 1}`).join(', ');
      const result = await db.query<ReminderRow>(
        `
          INSERT INTO notes (${INSERT_COLUMNS.join(', ')})
          VALUES (${placeholders})
          RETURNING *
        `,
        values,
      );

      return toDomain(result.rows[0]);
    },

    patch: async ({ reminderId, userId, patch }) => {
      const fields = patchToColumnValue(patch);
      if (fields.length === 0) {
        return await findByIdAndUser(db, { reminderId, userId });
      }

      const setClause = fields.map((field, index) => `${field.column} = $${index + 1}`).join(', ');
      const values = fields.map((field) => field.value);
      values.push(reminderId, userId);

      const updatedAtGuardEnabled =
        Object.hasOwn(patch, 'updatedAt') && patch.updatedAt instanceof Date;
      let updatedAtGuardClause = '';
      if (updatedAtGuardEnabled) {
        values.push(patch.updatedAt);
        updatedAtGuardClause = `\n            AND updated_at < $${fields.length + 3}`;
      }

      const result = await db.query<ReminderRow>(
        `
          UPDATE notes
          SET ${setClause}
          WHERE id = $${fields.length + 1}
            AND user_id = $${fields.length + 2}
            AND trigger_at IS NOT NULL
            ${updatedAtGuardClause}
          RETURNING *
        `,
        values,
      );

      if (result.rows.length === 0) {
        return null;
      }

      return toDomain(result.rows[0]);
    },

    deleteByIdForUser: async ({ reminderId, userId }) => {
      const result = await db.query<{ id: string }>(
        `
          DELETE FROM notes
          WHERE id = $1
            AND user_id = $2
            AND trigger_at IS NOT NULL
          RETURNING id
        `,
        [reminderId, userId],
      );

      return result.rows.length > 0;
    },
  };
};
