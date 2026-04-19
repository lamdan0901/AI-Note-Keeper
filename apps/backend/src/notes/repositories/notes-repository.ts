import type { DbQueryClient } from '../../auth/contracts.js';
import { pool } from '../../db/pool.js';
import type { NoteRecord } from '../contracts.js';

type NoteRow = Readonly<{
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

export type NoteCreateInput = Readonly<{
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
  version: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type NotePatchInput = Readonly<{
  title?: string | null;
  content?: string | null;
  contentType?: string | null;
  color?: string | null;
  active?: boolean;
  done?: boolean | null;
  isPinned?: boolean | null;
  triggerAt?: Date | null;
  repeatRule?: string | null;
  repeatConfig?: Record<string, unknown> | null;
  repeat?: Record<string, unknown> | null;
  snoozedUntil?: Date | null;
  scheduleStatus?: string | null;
  timezone?: string | null;
  baseAtLocal?: string | null;
  startAt?: Date | null;
  nextTriggerAt?: Date | null;
  lastFiredAt?: Date | null;
  lastAcknowledgedAt?: Date | null;
  deletedAt?: Date | null;
  updatedAt?: Date;
  version?: number;
}>;

export type NotesRepository = Readonly<{
  listByUser: (userId: string) => Promise<ReadonlyArray<NoteRecord>>;
  findByIdForUser: (input: Readonly<{ noteId: string; userId: string }>) => Promise<NoteRecord | null>;
  create: (input: NoteCreateInput) => Promise<NoteRecord>;
  patch: (input: Readonly<{ noteId: string; userId: string; patch: NotePatchInput }>) => Promise<NoteRecord | null>;
  hardDelete: (input: Readonly<{ noteId: string; userId: string }>) => Promise<boolean>;
  emptyTrash: (input: Readonly<{ userId: string }>) => Promise<number>;
}>;

const toDomain = (row: NoteRow): NoteRecord => {
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
    version: row.version ?? 1,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const INSERT_COLUMNS = [
  'id',
  'user_id',
  'title',
  'content',
  'content_type',
  'color',
  'active',
  'done',
  'is_pinned',
  'trigger_at',
  'repeat_rule',
  'repeat_config',
  'repeat',
  'snoozed_until',
  'schedule_status',
  'timezone',
  'base_at_local',
  'start_at',
  'next_trigger_at',
  'last_fired_at',
  'last_acknowledged_at',
  'version',
  'deleted_at',
  'created_at',
  'updated_at',
] as const;

const patchToColumnValue = (patch: NotePatchInput): Array<Readonly<{ column: string; value: unknown }>> => {
  const pairs: Array<Readonly<{ column: string; value: unknown }>> = [];

  const add = (column: string, value: unknown): void => {
    pairs.push({ column, value });
  };

  if (Object.hasOwn(patch, 'title')) add('title', patch.title ?? null);
  if (Object.hasOwn(patch, 'content')) add('content', patch.content ?? null);
  if (Object.hasOwn(patch, 'contentType')) add('content_type', patch.contentType ?? null);
  if (Object.hasOwn(patch, 'color')) add('color', patch.color ?? null);
  if (Object.hasOwn(patch, 'active')) add('active', patch.active ?? true);
  if (Object.hasOwn(patch, 'done')) add('done', patch.done ?? null);
  if (Object.hasOwn(patch, 'isPinned')) add('is_pinned', patch.isPinned ?? null);
  if (Object.hasOwn(patch, 'triggerAt')) add('trigger_at', patch.triggerAt ?? null);
  if (Object.hasOwn(patch, 'repeatRule')) add('repeat_rule', patch.repeatRule ?? null);
  if (Object.hasOwn(patch, 'repeatConfig')) add('repeat_config', patch.repeatConfig ?? null);
  if (Object.hasOwn(patch, 'repeat')) add('repeat', patch.repeat ?? null);
  if (Object.hasOwn(patch, 'snoozedUntil')) add('snoozed_until', patch.snoozedUntil ?? null);
  if (Object.hasOwn(patch, 'scheduleStatus')) add('schedule_status', patch.scheduleStatus ?? null);
  if (Object.hasOwn(patch, 'timezone')) add('timezone', patch.timezone ?? null);
  if (Object.hasOwn(patch, 'baseAtLocal')) add('base_at_local', patch.baseAtLocal ?? null);
  if (Object.hasOwn(patch, 'startAt')) add('start_at', patch.startAt ?? null);
  if (Object.hasOwn(patch, 'nextTriggerAt')) add('next_trigger_at', patch.nextTriggerAt ?? null);
  if (Object.hasOwn(patch, 'lastFiredAt')) add('last_fired_at', patch.lastFiredAt ?? null);
  if (Object.hasOwn(patch, 'lastAcknowledgedAt')) add('last_acknowledged_at', patch.lastAcknowledgedAt ?? null);
  if (Object.hasOwn(patch, 'deletedAt')) add('deleted_at', patch.deletedAt ?? null);
  if (Object.hasOwn(patch, 'updatedAt')) add('updated_at', patch.updatedAt ?? new Date());
  if (Object.hasOwn(patch, 'version')) add('version', patch.version ?? 1);

  return pairs;
};

const findByIdAndUser = async (
  db: DbQueryClient,
  input: Readonly<{ noteId: string; userId: string }>,
): Promise<NoteRecord | null> => {
  const result = await db.query<NoteRow>(
    `
      SELECT *
      FROM notes
      WHERE id = $1 AND user_id = $2
      LIMIT 1
    `,
    [input.noteId, input.userId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return toDomain(result.rows[0]);
};

export const createNotesRepository = (deps: Readonly<{ db?: DbQueryClient }> = {}): NotesRepository => {
  const db = deps.db ?? pool;

  return {
    listByUser: async (userId) => {
      const result = await db.query<NoteRow>(
        `
          SELECT *
          FROM notes
          WHERE user_id = $1
          ORDER BY updated_at DESC
        `,
        [userId],
      );

      return result.rows.map(toDomain);
    },

    findByIdForUser: async ({ noteId, userId }) => {
      return await findByIdAndUser(db, { noteId, userId });
    },

    create: async (input) => {
      const values = [
        input.id,
        input.userId,
        input.title,
        input.content,
        input.contentType,
        input.color,
        input.active,
        input.done,
        input.isPinned,
        input.triggerAt,
        input.repeatRule,
        input.repeatConfig,
        input.repeat,
        input.snoozedUntil,
        input.scheduleStatus,
        input.timezone,
        input.baseAtLocal,
        input.startAt,
        input.nextTriggerAt,
        input.lastFiredAt,
        input.lastAcknowledgedAt,
        input.version,
        input.deletedAt,
        input.createdAt,
        input.updatedAt,
      ];

      const placeholders = INSERT_COLUMNS.map((_, index) => `$${index + 1}`).join(', ');
      const result = await db.query<NoteRow>(
        `
          INSERT INTO notes (${INSERT_COLUMNS.join(', ')})
          VALUES (${placeholders})
          RETURNING *
        `,
        values,
      );

      return toDomain(result.rows[0]);
    },

    patch: async ({ noteId, userId, patch }) => {
      const fields = patchToColumnValue(patch);
      if (fields.length === 0) {
        return await findByIdAndUser(db, { noteId, userId });
      }

      const setClause = fields.map((field, index) => `${field.column} = $${index + 1}`).join(', ');
      const values = fields.map((field) => field.value);
      values.push(noteId, userId);

      const result = await db.query<NoteRow>(
        `
          UPDATE notes
          SET ${setClause}
          WHERE id = $${fields.length + 1} AND user_id = $${fields.length + 2}
          RETURNING *
        `,
        values,
      );

      if (result.rows.length === 0) {
        return null;
      }

      return toDomain(result.rows[0]);
    },

    hardDelete: async ({ noteId, userId }) => {
      const result = await db.query<{ id: string }>(
        `
          DELETE FROM notes
          WHERE id = $1 AND user_id = $2
          RETURNING id
        `,
        [noteId, userId],
      );

      return result.rows.length > 0;
    },

    emptyTrash: async ({ userId }) => {
      const result = await db.query<{ id: string }>(
        `
          DELETE FROM notes
          WHERE user_id = $1 AND active = false
          RETURNING id
        `,
        [userId],
      );

      return result.rows.length;
    },
  };
};
