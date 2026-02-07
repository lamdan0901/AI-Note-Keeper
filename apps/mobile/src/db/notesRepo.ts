import { SQLiteDatabase } from 'expo-sqlite/next';
import { Note } from '../../../../packages/shared/types/note';
export { Note };

export type NoteRow = {
  id: string;
  title: string | null;
  content: string | null;
  color: string | null;
  active: number;
  done: number;

  triggerAt: number | null;
  repeatRule: string | null;
  repeatConfig: string | null;
  snoozedUntil: number | null;
  scheduleStatus: string | null;
  timezone: string | null;

  repeat: string | null;
  baseAtLocal: string | null;
  startAt: number | null;
  nextTriggerAt: number | null;
  lastFiredAt: number | null;
  lastAcknowledgedAt: number | null;
  version: number;

  syncStatus: string | null;
  serverVersion: number;

  updatedAt: number;
  createdAt: number;
};

export const mapNoteRow = (row: NoteRow): Note => ({
  id: row.id,
  title: row.title,
  content: row.content,
  color: row.color,
  active: row.active === 1,
  done: row.done === 1,

  triggerAt: row.triggerAt || undefined,
  repeatRule: (row.repeatRule as Note['repeatRule']) || undefined,
  repeatConfig: row.repeatConfig
    ? (JSON.parse(row.repeatConfig) as Note['repeatConfig'])
    : undefined,
  snoozedUntil: row.snoozedUntil || undefined,
  scheduleStatus: (row.scheduleStatus as Note['scheduleStatus']) || undefined,
  timezone: row.timezone || undefined,

  repeat: row.repeat ? (JSON.parse(row.repeat) as Note['repeat']) : undefined,
  baseAtLocal: row.baseAtLocal || undefined,
  startAt: row.startAt || undefined,
  nextTriggerAt: row.nextTriggerAt || undefined,
  lastFiredAt: row.lastFiredAt || undefined,
  lastAcknowledgedAt: row.lastAcknowledgedAt || undefined,
  version: row.version || 0,

  syncStatus: (row.syncStatus as Note['syncStatus']) || 'synced',
  serverVersion: row.serverVersion || 0,

  updatedAt: row.updatedAt,
  createdAt: row.createdAt,
});

export const upsertNote = async (db: SQLiteDatabase, note: Note): Promise<void> => {
  await db.runAsync(
    `INSERT INTO notes (
        id,
        title,
        content,
        color,
        active,
        done,
        triggerAt,
        repeatRule,
        repeatConfig,
        snoozedUntil,
        scheduleStatus,
        timezone,
        repeat,
        baseAtLocal,
        startAt,
        nextTriggerAt,
        lastFiredAt,
        lastAcknowledgedAt,
        version,
        updatedAt,
        createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        color = excluded.color,
        active = excluded.active,
        done = excluded.done,
        triggerAt = excluded.triggerAt,
        repeatRule = excluded.repeatRule,
        repeatConfig = excluded.repeatConfig,
        snoozedUntil = excluded.snoozedUntil,
        scheduleStatus = excluded.scheduleStatus,
        timezone = excluded.timezone,
        repeat = excluded.repeat,
        baseAtLocal = excluded.baseAtLocal,
        startAt = excluded.startAt,
        nextTriggerAt = excluded.nextTriggerAt,
        lastFiredAt = excluded.lastFiredAt,
        lastAcknowledgedAt = excluded.lastAcknowledgedAt,
        version = excluded.version,
        updatedAt = excluded.updatedAt,
        createdAt = excluded.createdAt`,
    [
      note.id,
      note.title,
      note.content,
      note.color,
      note.active ? 1 : 0,
      note.done ? 1 : 0,
      note.triggerAt || null,
      note.repeatRule || null,
      note.repeatConfig ? JSON.stringify(note.repeatConfig) : null,
      note.snoozedUntil || null,
      note.scheduleStatus || null,
      note.timezone || null,
      note.repeat ? JSON.stringify(note.repeat) : null,
      note.baseAtLocal || null,
      note.startAt || null,
      note.nextTriggerAt || null,
      note.lastFiredAt || null,
      note.lastAcknowledgedAt || null,
      note.version || 0,
      note.updatedAt,
      note.createdAt,
    ],
  );
};

export const getNoteById = async (db: SQLiteDatabase, noteId: string): Promise<Note | null> => {
  const row = await db.getFirstAsync<NoteRow>(`SELECT * FROM notes WHERE id = ?`, [noteId]);
  return row ? mapNoteRow(row) : null;
};

export const listNotes = async (db: SQLiteDatabase, limit: number = 50): Promise<Note[]> => {
  const rows = await db.getAllAsync<NoteRow>(
    `SELECT * FROM notes WHERE active = 1 ORDER BY done ASC, updatedAt DESC LIMIT ?`,
    [limit],
  );
  return rows.map(mapNoteRow);
};

export const deleteNote = async (db: SQLiteDatabase, noteId: string): Promise<Note | null> => {
  const note = await getNoteById(db, noteId);
  if (!note) return null;

  const updated = { ...note, active: false, updatedAt: Date.now() };
  await upsertNote(db, updated);
  return updated;
};
