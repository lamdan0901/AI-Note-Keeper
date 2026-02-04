import { SQLiteDatabase } from 'expo-sqlite/next';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../convex/_generated/api';
import { upsertNote } from '../db/notesRepo';
import { fetchNotes } from './fetchNotes';
import { ReminderRepeatRule } from '../../../../packages/shared/types/reminder';
import { ReminderScheduleStatus } from '../../../../packages/shared/types/reminder';

type NoteOutboxEntry = {
  noteId: string;
  userId: string;
  operation: string; // "create" | "update" | "delete"
  payloadJson: string;
  attempts: number;
  // ... other fields
};

export const syncNotes = async (db: SQLiteDatabase, userId: string = 'local-user') => {
  console.log('[Sync] Starting note sync...');

  // 1. PUSH: Send Outbox items to Convex
  const outboxItems = await db.getAllAsync<NoteOutboxEntry>(
    `SELECT * FROM note_outbox ORDER BY createdAt ASC`,
  );

  if (outboxItems.length > 0) {
    console.log(`[Sync] Found ${outboxItems.length} items to push.`);
    const changes = outboxItems.map((item) => {
      const payload = JSON.parse(item.payloadJson);
      return {
        id: payload.id,
        userId: item.userId,
        title: payload.title ?? undefined,
        content: payload.content ?? undefined,
        color: payload.color ?? undefined,
        active: payload.active,
        done: payload.done ?? undefined,
        triggerAt: payload.triggerAt ?? undefined,
        repeatRule: payload.repeatRule ?? undefined,
        repeatConfig: payload.repeatConfig ?? undefined,
        snoozedUntil: payload.snoozedUntil ?? undefined,
        scheduleStatus: payload.scheduleStatus ?? undefined,
        timezone: payload.timezone ?? undefined,
        updatedAt: payload.updatedAt,
        createdAt: payload.createdAt,
        operation: item.operation,
        deviceId: 'mobile-device-id',
      };
    });

    try {
      const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
      if (!convexUrl) throw new Error('Missing Convex URL');
      const client = new ConvexHttpClient(convexUrl);

      // Call sync mutation
      const result = await client.mutation(api.functions.notes.syncNotes, {
        userId,
        changes,
        lastSyncAt: 0, // Simplified
      });

      // If successful, clear outbox
      // In a robust system, we'd clear only processed IDs
      const ids = outboxItems
        .map((i) => i.noteId)
        .map((id) => `'${id}'`)
        .join(',');
      await db.runAsync(`DELETE FROM note_outbox WHERE noteId IN (${ids})`);
      console.log('[Sync] Push successful. Outbox cleared.');

      // Update local state with server state (Optimistic confirmation)
      // The server returns the full list of notes. We can upsert them.
      for (const serverNote of result.notes) {
        await upsertNote(db, {
          id: serverNote.id,
          title: serverNote.title ?? null,
          content: serverNote.content ?? null,
          color: serverNote.color ?? null,
          active: serverNote.active,
          done: serverNote.done ?? false,

          triggerAt: serverNote.triggerAt,
          repeatRule: serverNote.repeatRule as ReminderRepeatRule,
          repeatConfig: serverNote.repeatConfig,
          snoozedUntil: serverNote.snoozedUntil,
          scheduleStatus: serverNote.scheduleStatus as ReminderScheduleStatus,
          timezone: serverNote.timezone,

          updatedAt: serverNote.updatedAt,
          createdAt: serverNote.createdAt,
        });
      }
    } catch (e) {
      console.error('[Sync] Push failed:', e);
      // In a real app, increment attempt counters and implement backoff
    }
  } else {
    // 2. PULL: If nothing to push, check for updates
    // (If we pushed, we already got updates in response)
    const fetchResult = await fetchNotes(userId);
    if (fetchResult.status === 'ok') {
      for (const serverNote of fetchResult.notes) {
        await upsertNote(db, serverNote);
      }
      console.log(`[Sync] Pulled ${fetchResult.notes.length} notes.`);
    }
  }
};
