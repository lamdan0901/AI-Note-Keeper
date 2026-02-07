import { SQLiteDatabase } from 'expo-sqlite/next';
import { Note, upsertNote } from '../db/notesRepo';
import { markNoteConflict, markNoteSynced } from '../db/syncHelpers';
import { resolveNoteConflict } from './conflictResolution';
import { fetchNotes } from './fetchNotes';
import { enqueueNoteOperation, getAllOutboxEntries } from './noteOutbox';
import { processQueue, getQueueStats } from './syncQueueProcessor';

// ============================================================================
// Structured Logging
// ============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const log = (level: LogLevel, message: string, context?: Record<string, unknown>): void => {
  const timestamp = new Date().toISOString();
  const ctx = context ? ` ${JSON.stringify(context)}` : '';
  const formatted = `[${timestamp}] [${level.toUpperCase()}] [Sync] ${message}${ctx}`;

  switch (level) {
    case 'error':
      console.error(formatted);
      break;
    case 'warn':
      console.warn(formatted);
      break;
    default:
      console.log(formatted);
  }
};

// ============================================================================
// Sync Result Types
// ============================================================================

export type SyncResult = {
  success: boolean;
  pullCount: number;
  pushResult: {
    total: number;
    succeeded: number;
    failed: number;
  };
  conflictCount: number;
  mergeCount: number;
  error?: string;
};

// ============================================================================
// Main Sync Function
// ============================================================================

export const syncNotes = async (
  db: SQLiteDatabase,
  userId: string = 'local-user',
): Promise<SyncResult> => {
  const startTime = Date.now();
  let pullCount = 0;
  let conflictCount = 0;
  let mergeCount = 0;

  log('info', 'Starting smart sync', { userId });

  // Log queue stats before sync
  const preStats = await getQueueStats(db);
  log('debug', 'Pre-sync queue stats', preStats);

  // -------------------------------------------------------------------------
  // 1. PULL: Fetch latest state from server
  // -------------------------------------------------------------------------
  const fetchResult = await fetchNotes(userId);

  if (fetchResult.status === 'error') {
    log('error', 'Pull failed, aborting sync', { error: fetchResult.error });
    return {
      success: false,
      pullCount: 0,
      pushResult: { total: 0, succeeded: 0, failed: 0 },
      conflictCount: 0,
      mergeCount: 0,
      error: String(fetchResult.error),
    };
  }

  const serverNotes = fetchResult.notes || [];
  pullCount = serverNotes.length;
  log('info', `Pulled ${pullCount} notes from server`);

  // -------------------------------------------------------------------------
  // 2. RECONCILE: Check for conflicts between Server and Outbox
  // -------------------------------------------------------------------------
  const allOutboxItems = await getAllOutboxEntries(db);
  const outboxMap = new Map(allOutboxItems.map((item) => [item.noteId, item]));

  log('debug', 'Reconciling with outbox', {
    serverNotes: serverNotes.length,
    outboxItems: allOutboxItems.length,
  });

  for (const serverNote of serverNotes) {
    const outboxEntry = outboxMap.get(serverNote.id);

    if (outboxEntry) {
      // We have local changes pending. Check for conflict.
      const localPayload = JSON.parse(outboxEntry.payloadJson) as Note;
      const conflictResult = resolveNoteConflict(localPayload, serverNote);

      if (conflictResult.type === 'input_required') {
        log('warn', `Conflict detected for note ${serverNote.id}`, {
          localVersion: localPayload.serverVersion,
          serverVersion: serverNote.version,
        });

        // Mark as conflict in DB
        await markNoteConflict(db, serverNote.id);

        // Remove from Outbox so we don't overwrite server
        await db.runAsync('DELETE FROM note_outbox WHERE noteId = ?', [serverNote.id]);

        conflictCount++;
      } else {
        // Auto-mergeable or no conflict
        if (conflictResult.type === 'none' && conflictResult.mergedNote) {
          const merged = conflictResult.mergedNote;

          // If the merge actually changed something compared to our local pending state
          if (JSON.stringify(merged) !== JSON.stringify(localPayload)) {
            log('info', `Auto-merged note ${serverNote.id}`);

            // Update Local DB
            await upsertNote(db, merged);

            // Update Outbox with merged payload
            await enqueueNoteOperation(
              db,
              merged,
              outboxEntry.operation,
              userId,
              outboxEntry.createdAt,
            );

            mergeCount++;
          }
        }
      }
    } else {
      // No pending local changes. Safe to update local DB with server state.
      await upsertNote(db, serverNote);
      await markNoteSynced(db, serverNote.id, serverNote.version || 0);
    }
  }

  log('debug', 'Reconciliation complete', { conflictCount, mergeCount });

  // -------------------------------------------------------------------------
  // 3. PUSH: Process outbox queue with batching and partial failure handling
  // -------------------------------------------------------------------------
  const pushResult = await processQueue(db, userId);

  // -------------------------------------------------------------------------
  // 4. Summary
  // -------------------------------------------------------------------------
  const elapsed = Date.now() - startTime;
  const postStats = await getQueueStats(db);

  log('info', `Sync completed in ${elapsed}ms`, {
    pullCount,
    pushed: pushResult.succeeded,
    failed: pushResult.failed,
    conflicts: conflictCount,
    merges: mergeCount,
    remainingPending: postStats.pending,
    remainingRetrying: postStats.retrying,
  });

  return {
    success: pushResult.failed === 0 && conflictCount === 0,
    pullCount,
    pushResult: {
      total: pushResult.total,
      succeeded: pushResult.succeeded,
      failed: pushResult.failed,
    },
    conflictCount,
    mergeCount,
  };
};
