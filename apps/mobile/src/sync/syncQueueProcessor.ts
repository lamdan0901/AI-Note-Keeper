/**
 * syncQueueProcessor.ts
 *
 * Handles ordered processing of the sync outbox queue with:
 * - Batched operations for efficiency
 * - Partial failure handling (individual item errors don't abort entire batch)
 * - Comprehensive structured logging
 * - Transaction safety
 */

import { ConvexHttpClient } from 'convex/browser';
import { SQLiteDatabase } from 'expo-sqlite/next';
import { api } from '../../../../convex/_generated/api';
import { Note } from '../db/notesRepo';
import { nowMs } from '../../../../packages/shared/utils/time';
import {
  getPendingOperations,
  markOperationFailed,
  clearSuccessfulOperations,
  NoteOperation,
} from './noteOutbox';
import { markNoteSynced } from '../db/syncHelpers';

// ============================================================================
// Types
// ============================================================================

export type SyncOperationResult = {
  noteId: string;
  success: boolean;
  error?: string;
  serverVersion?: number;
};

export type BatchResult = {
  total: number;
  succeeded: number;
  failed: number;
  results: SyncOperationResult[];
};

export type QueueProcessorConfig = {
  batchSize: number;
  maxConcurrent: number;
  timeoutMs: number;
};

type OutboxItem = {
  noteId: string;
  userId: string;
  operation: NoteOperation;
  payloadJson: string;
  payloadHash: string;
  updatedAt: number;
  createdAt: number;
  attempts: number;
  lastAttemptAt: number | null;
  retryCount: number;
  nextRetryAt: number | null;
};

// ============================================================================
// Logging
// ============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogEntry = {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  context?: Record<string, unknown>;
};

const formatLog = (entry: LogEntry): string => {
  const ctx = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
  return `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.component}] ${entry.message}${ctx}`;
};

const log = (level: LogLevel, message: string, context?: Record<string, unknown>): void => {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    component: 'SyncQueue',
    message,
    context,
  };

  const formatted = formatLog(entry);
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
// Configuration
// ============================================================================

const DEFAULT_CONFIG: QueueProcessorConfig = {
  batchSize: 10, // Process up to 10 items per batch
  maxConcurrent: 1, // Sequential processing for now (safer for ordering)
  timeoutMs: 30000, // 30 second timeout per batch
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Sync batch timed out'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

// ============================================================================
// Queue Processor
// ============================================================================

/**
 * Maps an outbox item to the API payload format expected by Convex
 */
const mapToApiPayload = (item: OutboxItem) => {
  const payload = JSON.parse(item.payloadJson) as Note;
  return {
    id: payload.id,
    userId: item.userId,
    title: payload.title ?? undefined,
    content: payload.content ?? undefined,
    color: payload.color ?? undefined,
    active: payload.active,
    done: payload.done ?? undefined,
    isPinned: payload.isPinned ?? undefined,
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
    version: payload.version,
    baseVersion: payload.serverVersion,
  };
};

/**
 * Process a single batch of outbox items
 */
const processBatch = async (
  client: ConvexHttpClient,
  db: SQLiteDatabase,
  items: OutboxItem[],
  userId: string,
  timeoutMs: number,
): Promise<BatchResult> => {
  const results: SyncOperationResult[] = [];
  const startTime = nowMs();

  log('info', `Processing batch of ${items.length} items`, {
    noteIds: items.map((i) => i.noteId),
  });

  // Group operations by type for optimal ordering:
  // 1. Creates first (so they exist for potential later operations)
  // 2. Updates second
  // 3. Deletes last
  const orderedItems = [...items].sort((a, b) => {
    const order = { create: 1, update: 2, delete: 3 };
    return order[a.operation] - order[b.operation];
  });

  // Map to API payloads
  const changes = orderedItems.map(mapToApiPayload);

  try {
    // Send batch to server
    const result = await withTimeout(
      client.mutation(api.functions.notes.syncNotes, {
        userId,
        changes,
        lastSyncAt: 0,
      }),
      timeoutMs,
    );

    // Process results - assume all succeeded if we got here
    // Map server responses back to our items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const serverNotesMap = new Map(result.notes.map((n: any) => [n.id, n]));

    for (const item of orderedItems) {
      const serverNote = serverNotesMap.get(item.noteId);
      if (serverNote || item.operation === 'delete') {
        // Success!
        results.push({
          noteId: item.noteId,
          success: true,
          serverVersion: serverNote?.version,
        });
        log('debug', `Synced ${item.operation}: ${item.noteId}`, {
          serverVersion: serverNote?.version,
        });
      } else {
        // Note not in response but not a delete - unexpected
        results.push({
          noteId: item.noteId,
          success: false,
          error: 'Note not returned in server response',
        });
        log('warn', `Note not in server response: ${item.noteId}`);
      }
    }

    // Clear successful operations from outbox
    const successfulIds = results.filter((r) => r.success).map((r) => r.noteId);
    if (successfulIds.length > 0) {
      await clearSuccessfulOperations(db, successfulIds);

      // Update sync status for successful items
      for (const result of results.filter((r) => r.success && r.serverVersion !== undefined)) {
        await markNoteSynced(db, result.noteId, result.serverVersion!);
      }
    }

    // Mark failed operations
    for (const result of results.filter((r) => !r.success)) {
      await markOperationFailed(db, result.noteId, result.error || 'Unknown error');
    }

    const elapsed = nowMs() - startTime;
    log('info', `Batch completed in ${elapsed}ms`, {
      succeeded: successfulIds.length,
      failed: results.filter((r) => !r.success).length,
    });
  } catch (error) {
    // Entire batch failed - handle individually
    const errorMsg = error instanceof Error ? error.message : String(error);
    log('error', `Batch failed: ${errorMsg}`, { noteIds: items.map((i) => i.noteId) });

    // Try to identify which items failed if server gives us info
    // For now, mark all as failed with retry
    for (const item of orderedItems) {
      results.push({
        noteId: item.noteId,
        success: false,
        error: errorMsg,
      });
      await markOperationFailed(db, item.noteId, errorMsg);
    }
  }

  return {
    total: items.length,
    succeeded: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
};

/**
 * Process the entire outbox queue in batches
 */
export const processQueue = async (
  db: SQLiteDatabase,
  userId: string,
  config: Partial<QueueProcessorConfig> = {},
): Promise<BatchResult> => {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const allResults: SyncOperationResult[] = [];
  const startTime = nowMs();

  log('info', 'Starting queue processing', { config: cfg });

  // Get Convex client
  const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    log('error', 'Missing Convex URL');
    return { total: 0, succeeded: 0, failed: 0, results: [] };
  }
  const client = new ConvexHttpClient(convexUrl);

  // Get all pending operations ready for retry
  const pendingItems = (await getPendingOperations(db)) as OutboxItem[];

  if (pendingItems.length === 0) {
    log('info', 'No pending items to process');
    return { total: 0, succeeded: 0, failed: 0, results: [] };
  }

  log('info', `Found ${pendingItems.length} pending items`);

  // Process in batches
  let batchNumber = 0;
  for (let i = 0; i < pendingItems.length; i += cfg.batchSize) {
    batchNumber++;
    const batch = pendingItems.slice(i, i + cfg.batchSize);

    log('debug', `Processing batch ${batchNumber}`, {
      startIndex: i,
      batchSize: batch.length,
    });

    const batchResult = await processBatch(client, db, batch, userId, cfg.timeoutMs);
    allResults.push(...batchResult.results);

    // If entire batch failed, consider stopping (circuit breaker)
    if (batchResult.failed === batch.length && batch.length > 1) {
      log('warn', 'Entire batch failed, stopping queue processing to prevent cascade');
      break;
    }
  }

  const elapsed = nowMs() - startTime;
  const succeeded = allResults.filter((r) => r.success).length;
  const failed = allResults.filter((r) => !r.success).length;

  log('info', `Queue processing completed in ${elapsed}ms`, {
    total: allResults.length,
    succeeded,
    failed,
    batchesProcessed: batchNumber,
  });

  return {
    total: allResults.length,
    succeeded,
    failed,
    results: allResults,
  };
};

/**
 * Get queue statistics for monitoring/debugging
 */
export const getQueueStats = async (
  db: SQLiteDatabase,
): Promise<{
  pending: number;
  retrying: number;
  maxedOut: number;
}> => {
  const now = nowMs();

  const pending = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM note_outbox WHERE nextRetryAt IS NULL OR nextRetryAt <= ?`,
    [now],
  );

  const retrying = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM note_outbox WHERE nextRetryAt > ?`,
    [now],
  );

  const maxedOut = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM note_outbox WHERE retryCount >= 5`,
  );

  return {
    pending: pending?.count || 0,
    retrying: retrying?.count || 0,
    maxedOut: maxedOut?.count || 0,
  };
};

/**
 * Force retry all failed items (reset their retry state)
 */
export const forceRetryAll = async (db: SQLiteDatabase): Promise<number> => {
  log('info', 'Force retrying all failed items');

  const result = await db.runAsync(
    `UPDATE note_outbox SET retryCount = 0, nextRetryAt = NULL WHERE retryCount > 0`,
  );

  log('info', `Reset ${result.changes} items for retry`);
  return result.changes;
};
