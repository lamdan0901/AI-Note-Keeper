import { AppRegistry } from 'react-native';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../convex/_generated/api';
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

const getConvexClient = () => {
  const url = process.env.EXPO_PUBLIC_CONVEX_URL;
  if (!url) return null;
  return new ConvexHttpClient(url);
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
    const nextTrigger = computeNextTrigger(
      now,
      note.triggerAt || now, // Use triggerAt as anchor if startAt is missing (best effort)
      note.timezone ? new Date().toISOString() : new Date().toISOString(), // TODO: Use stored baseAtLocal if available, else current local time
      repeatRule,
    );

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

    // 4. Sync to Convex
    const client = getConvexClient();
    if (client) {
      try {
        await client.mutation(api.functions.reminders.ackReminder, {
          id: noteId, // Cast ID
          ackType: 'done',
          optimisticNextTrigger: nextTrigger ?? undefined,
        });
        logSyncEvent('info', 'headless_done_sync_success', { noteId });
      } catch (syncError) {
        logSyncEvent('warn', 'headless_done_sync_failed', {
          noteId,
          error: String(syncError),
        });
        // We failed to sync, but local state is updated.
        // The 'note_outbox' or 'syncNotes' mechanism ideally handles this later.
        // Since we modified the note locally, we should probably mark it for sync?
        // Current syncNotes implementation relies on 'note_outbox'.
        // TODO: We should push to outbox here for reliability if we want robust offline sync.
        // For now, we rely on 'ackReminder' call. Use 'syncNotes' on next app open to reconcile.
      }
    }
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
    await deleteNoteOffline(db, note, note.userId || 'local-user');

    // 2. Sync to Convex (Best effort)
    // We use syncNotes which picks up the deletion from the outbox
    await syncNotes(db, note.userId || 'local-user');

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
