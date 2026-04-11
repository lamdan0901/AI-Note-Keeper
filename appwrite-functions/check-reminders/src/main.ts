import { Client, Databases, Functions, ID, Query } from 'node-appwrite';
import { computeNextTrigger } from './utils/recurrence.js';
import type { RepeatRule } from './utils/recurrence.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATABASE_ID = 'ai-note-keeper';
const NOTES_COLLECTION = 'notes';
const CRON_STATE_COLLECTION = 'cronState';
const CRON_KEY = 'check-reminders';
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const PAGE_LIMIT = 200;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AppwriteRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  query: Record<string, string>;
}

interface AppwriteResponse {
  json(data: unknown, statusCode?: number): void;
}

interface AppwriteContext {
  req: AppwriteRequest;
  res: AppwriteResponse;
  log: (msg: string) => void;
  error: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// Main handler — ported from convex/functions/reminderTriggers.ts
// ---------------------------------------------------------------------------

export default async function main(context: AppwriteContext): Promise<void> {
  const { res, log, error } = context;

  const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT;
  const apiKey = process.env.APPWRITE_FUNCTION_API_KEY;
  const projectId = process.env.APPWRITE_FUNCTION_PROJECT_ID;
  const pushFunctionId = process.env.PUSH_FUNCTION_ID;

  if (!endpoint || !apiKey || !projectId) {
    error(
      'Missing APPWRITE_FUNCTION_API_ENDPOINT, APPWRITE_FUNCTION_PROJECT_ID, or APPWRITE_FUNCTION_API_KEY',
    );
    return res.json({ error: 'Internal server error' }, 500);
  }

  const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  const databases = new Databases(client);
  const functions = new Functions(client);

  const now = Date.now();

  // -------------------------------------------------------------------------
  // 1. Read watermark
  // -------------------------------------------------------------------------
  const { since, watermarkDocId } = await readWatermark(databases, now, log);
  log(`[CheckReminders] Checking window [${since}, ${now}]`);

  // -------------------------------------------------------------------------
  // 2. Query due notes — three time windows via OR
  // node-appwrite v14 supports Query.or()
  // -------------------------------------------------------------------------
  // Paginate through ALL due notes before advancing watermark — a single page would
  // silently drop reminders beyond PAGE_LIMIT and advance the watermark past them.
  let dueNotes: Record<string, unknown>[] = [];
  try {
    let offset = 0;
    while (true) {
      const result = await databases.listDocuments(DATABASE_ID, NOTES_COLLECTION, [
        Query.equal('active', true),
        Query.or([
          Query.and([
            Query.greaterThanEqual('nextTriggerAt', since),
            Query.lessThanEqual('nextTriggerAt', now),
          ]),
          Query.and([
            Query.greaterThanEqual('snoozedUntil', since),
            Query.lessThanEqual('snoozedUntil', now),
          ]),
          // Legacy fallback: notes created before nextTriggerAt was introduced
          Query.and([
            Query.greaterThanEqual('triggerAt', since),
            Query.lessThanEqual('triggerAt', now),
          ]),
        ]),
        Query.limit(PAGE_LIMIT),
        Query.offset(offset),
      ]);
      const page = result.documents as unknown as Record<string, unknown>[];
      dueNotes.push(...page);
      if (page.length < PAGE_LIMIT) break;
      offset += PAGE_LIMIT;
    }
  } catch (err) {
    error(`[CheckReminders] Failed to query due notes: ${String(err)}`);
    return res.json({ error: 'Failed to query' }, 500);
  }

  log(`[CheckReminders] Found ${dueNotes.length} due note(s)`);

  // -------------------------------------------------------------------------
  // 3. Process each due note
  // -------------------------------------------------------------------------
  let triggered = 0;
  for (const doc of dueNotes) {
    const noteId = doc['$id'] as string;
    const userId = doc['userId'] as string;

    try {
      const triggerTime =
        (doc['snoozedUntil'] as number | null) ??
        (doc['nextTriggerAt'] as number | null) ??
        (doc['triggerAt'] as number | null) ??
        now;

      const eventId = `${noteId}-${triggerTime}`;

      // Fire push asynchronously — must not block reminder advancement
      if (pushFunctionId) {
        try {
          await functions.createExecution(
            pushFunctionId,
            JSON.stringify({
              type: 'reminder',
              userId,
              reminderId: noteId,
              changeEventId: eventId,
              isTrigger: true,
            }),
            true, // async
          );
        } catch (pushErr) {
          error(`[CheckReminders] Push dispatch failed for ${noteId}: ${String(pushErr)}`);
        }
      }

      // Advance reminder state
      const markFields = computeMarkTriggeredFields(doc, now);
      await databases.updateDocument(DATABASE_ID, NOTES_COLLECTION, noteId, markFields);

      log(`[CheckReminders] Triggered ${noteId} (eventId=${eventId})`);
      triggered++;
    } catch (err) {
      error(`[CheckReminders] Failed to process note ${noteId}: ${String(err)}`);
    }
  }

  // -------------------------------------------------------------------------
  // 4. Advance watermark
  // -------------------------------------------------------------------------
  await upsertWatermark(databases, watermarkDocId, now, log, error);

  log(`[CheckReminders] Done. Triggered ${triggered}/${dueNotes.length}`);
  return res.json({ triggered, checked: dueNotes.length });
}

// ---------------------------------------------------------------------------
// Mark reminder as triggered — ported from reminderTriggers.markReminderTriggered
// ---------------------------------------------------------------------------

function computeMarkTriggeredFields(
  doc: Record<string, unknown>,
  now: number,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    updatedAt: now,
    snoozedUntil: null,
  };

  const startAt =
    (doc['startAt'] as number | null) ??
    (doc['triggerAt'] as number | null) ??
    (doc['nextTriggerAt'] as number | null);

  const baseAtLocal = doc['baseAtLocal'] as string | null;
  const timezone = (doc['timezone'] as string | null) ?? 'UTC';

  let repeat: RepeatRule | null = null;
  try {
    const raw = doc['repeat'] as string | null;
    if (raw) repeat = JSON.parse(raw) as RepeatRule;
  } catch {
    // ignore malformed
  }

  const hasRecurrence = !!(repeat && startAt && baseAtLocal);

  if (hasRecurrence) {
    const next = computeNextTrigger(now, startAt!, baseAtLocal!, repeat!, timezone);
    if (next) {
      fields['nextTriggerAt'] = next;
      fields['lastFiredAt'] = now;
      fields['scheduleStatus'] = 'scheduled';
    } else {
      fields['nextTriggerAt'] = null;
      fields['scheduleStatus'] = 'unscheduled';
    }
  } else {
    fields['nextTriggerAt'] = null;
    fields['scheduleStatus'] = 'unscheduled';
  }

  return fields;
}

// ---------------------------------------------------------------------------
// Watermark helpers — ported from getCronWatermark / updateCronWatermark
// ---------------------------------------------------------------------------

async function readWatermark(
  databases: Databases,
  now: number,
  log: (msg: string) => void,
): Promise<{ since: number; watermarkDocId: string | null }> {
  try {
    const result = await databases.listDocuments(DATABASE_ID, CRON_STATE_COLLECTION, [
      Query.equal('key', CRON_KEY),
      Query.limit(1),
    ]);
    const doc = result.documents[0];
    if (doc) {
      const watermark = doc['watermark'] as number | undefined;
      return {
        since: watermark ?? now - FIVE_MINUTES_MS,
        watermarkDocId: doc['$id'] as string,
      };
    }
  } catch (err) {
    log(`[CheckReminders] Could not read watermark: ${String(err)}`);
  }
  return { since: now - FIVE_MINUTES_MS, watermarkDocId: null };
}

async function upsertWatermark(
  databases: Databases,
  watermarkDocId: string | null,
  now: number,
  log: (msg: string) => void,
  error: (msg: string) => void,
): Promise<void> {
  try {
    if (watermarkDocId) {
      await databases.updateDocument(DATABASE_ID, CRON_STATE_COLLECTION, watermarkDocId, {
        watermark: now,
      });
    } else {
      await databases.createDocument(DATABASE_ID, CRON_STATE_COLLECTION, ID.unique(), {
        key: CRON_KEY,
        watermark: now,
      });
    }
    log(`[CheckReminders] Watermark updated to ${now}`);
  } catch (err) {
    error(`[CheckReminders] Failed to update watermark: ${String(err)}`);
  }
}
