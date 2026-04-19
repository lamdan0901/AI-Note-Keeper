import { AppRegistry } from 'react-native';
import { computeNextTrigger } from '../../../../packages/shared/utils/recurrence';
import { getDb } from '../db/bootstrap';
import { getNoteById, upsertNote } from '../db/notesRepo';
import {
  mapNoteToReminder,
  rescheduleAllActiveReminders,
  rescheduleNoteWithLedger,
} from './scheduler';
import { logSyncEvent } from './logging';
import { deleteNoteOffline } from '../notes/editor';
import { syncNotes } from '../sync/noteSync';
import { resolveCurrentUserId } from '../auth/session';

const REMINDER_DONE_TASK = 'ReminderDone';
const REMINDER_RESCHEDULE_TASK = 'ReminderReschedule';
const REMINDER_DELETE_TASK = 'ReminderDelete';

import { RepeatRule } from '../../../../packages/shared/types/reminder';
import { Note } from '../db/notesRepo';

// Helper to convert legacy/flat Note repeat fields to rich RepeatRule object
const getRepeatRule = (note: Note): RepeatRule | null => {
  if (!note.repeatRule || note.repeatRule === 'none') return null;

  const config = (note.repeatConfig || {}) as {
    interval?: unknown;
    weekdays?: unknown;
    frequency?: unknown;
  };

  const rule = note.repeatRule as string | undefined;
  const interval = typeof config.interval === 'number' ? config.interval : 1;

  if (rule === 'daily') {
    return { kind: 'daily', interval };
  }
  if (rule === 'weekly') {
    const weekdays = Array.isArray(config.weekdays) ? (config.weekdays as number[]) : [];
    return { kind: 'weekly', interval, weekdays };
  }
  if (rule === 'monthly') {
    return { kind: 'monthly', interval, mode: 'day_of_month' };
  }
  if (rule === 'custom') {
    const freqRaw = typeof config.frequency === 'string' ? config.frequency : 'days';
    const frequency = (
      ['minutes', 'days', 'weeks', 'months'].includes(freqRaw) ? freqRaw : 'days'
    ) as 'minutes' | 'days' | 'weeks' | 'months';

    return {
      kind: 'custom',
      interval,
      frequency,
    };
  }
  return null;
};

interface DoneTaskData {
  noteId?: string;
  reminderId?: string; // Legacy/Fallback
}

const reminderDoneTask = async (data: DoneTaskData) => {
  const noteId = data.noteId || data.reminderId;
  const now = Date.now();

  logSyncEvent('info', 'headless_done_start', { noteId });

  if (!noteId) {
    console.error('[Headless] Missing noteId for Done task');
    return;
  }

  try {
    const db = await getDb();
    const note = await getNoteById(db, noteId);

    if (!note) {
      logSyncEvent('warn', 'headless_done_note_not_found', { noteId });
      return;
    }

    // 1. Calculate next trigger (Optimistic)
    const repeatRule = getRepeatRule(note);
    const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const baseLocal = note.baseAtLocal ?? null;
    const anchor = note.startAt || note.triggerAt || now;
    const nextTrigger = baseLocal
      ? computeNextTrigger(now, anchor, baseLocal, repeatRule, note.timezone || deviceTz)
      : null;

    // 2. Update Local State
    const updatedNote: Note = {
      ...note,
      done: true,
      triggerAt: nextTrigger ?? undefined,
      snoozedUntil: undefined, // Clear snooze
      updatedAt: now,
      scheduleStatus: nextTrigger ? 'scheduled' : 'unscheduled',
    };

    await upsertNote(db, updatedNote);

    // 3. Reschedule Alarm (Native)
    // Even if nextTrigger is null, this will cancel existing alarms via Ledger
    await rescheduleNoteWithLedger(db, mapNoteToReminder(updatedNote));

    // 4. Best-effort sync through existing outbox-backed Express transport.
    const currentUserId = note.userId ?? (await resolveCurrentUserId());
    await syncNotes(db, currentUserId);
    logSyncEvent('info', 'headless_done_sync_success', { noteId });
  } catch (e) {
    logSyncEvent('error', 'headless_done_fatal', { error: String(e) });
  }
};

const reminderRescheduleTask = async () => {
  logSyncEvent('info', 'headless_reschedule_start');
  try {
    const db = await getDb();
    const count = await rescheduleAllActiveReminders(db);
    logSyncEvent('info', 'headless_reschedule_complete', { count });
  } catch (e) {
    logSyncEvent('error', 'headless_reschedule_failed', { error: String(e) });
  }
};

const reminderDeleteTask = async (data: { reminderId: string }) => {
  const noteId = data.reminderId;
  logSyncEvent('info', 'headless_delete_start', { noteId });

  if (!noteId) {
    console.error('[Headless] Missing noteId for Delete task');
    return;
  }

  try {
    const db = await getDb();
    const note = await getNoteById(db, noteId);

    if (!note) {
      logSyncEvent('warn', 'headless_delete_note_not_found', { noteId });
      return;
    }

    // 1. Local Delete + Outbox
    const currentUserId = note.userId ?? (await resolveCurrentUserId());
    await deleteNoteOffline(db, note, currentUserId);

    // 2. Sync to Convex (Best effort)
    // We use syncNotes which picks up the deletion from the outbox
    await syncNotes(db, currentUserId);

    logSyncEvent('info', 'headless_delete_complete', { noteId });
  } catch (e) {
    logSyncEvent('error', 'headless_delete_failed', { error: String(e) });
  }
};

export const registerHeadlessTasks = () => {
  AppRegistry.registerHeadlessTask(REMINDER_DONE_TASK, () => reminderDoneTask);
  AppRegistry.registerHeadlessTask(REMINDER_RESCHEDULE_TASK, () => reminderRescheduleTask);
  AppRegistry.registerHeadlessTask(REMINDER_DELETE_TASK, () => reminderDeleteTask);
};
