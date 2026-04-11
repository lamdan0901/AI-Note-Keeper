import { Client, Databases, ID, Query } from 'node-appwrite';
import { computeNextTrigger } from './utils/recurrence.js';
import type { RepeatRule } from './utils/recurrence.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATABASE_ID = 'ai-note-keeper';
const NOTES_COLLECTION = 'notes';
const NOTE_CHANGE_EVENTS_COLLECTION = 'noteChangeEvents';

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
// Serialization helpers
// ---------------------------------------------------------------------------

function serializeJsonField(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

function deserializeJsonField(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDocToReminder(doc: Record<string, any>) {
  return {
    id: doc.$id as string,
    userId: doc.userId as string,
    title: doc.title ?? null,
    triggerAt: doc.triggerAt as number,
    repeatRule: doc.repeatRule ?? 'none',
    repeatConfig: deserializeJsonField(doc.repeatConfig),
    repeat: deserializeJsonField(doc.repeat as string | null),
    baseAtLocal: doc.baseAtLocal ?? null,
    startAt: doc.startAt ?? null,
    nextTriggerAt: doc.nextTriggerAt ?? null,
    lastFiredAt: doc.lastFiredAt ?? null,
    lastAcknowledgedAt: doc.lastAcknowledgedAt ?? null,
    snoozedUntil: doc.snoozedUntil ?? null,
    active: Boolean(doc.active),
    scheduleStatus: doc.scheduleStatus ?? 'unscheduled',
    timezone: doc.timezone ?? 'UTC',
    version: doc.version ?? 0,
    updatedAt: doc.updatedAt as number,
    createdAt: doc.createdAt as number,
  };
}

// ---------------------------------------------------------------------------
// Route helpers
// ---------------------------------------------------------------------------

function extractId(path: string): string | null {
  // path is like /:id, /:id/ack, /:id/snooze
  const parts = path.replace(/^\//, '').split('/');
  return parts[0] || null;
}

function extractSuffix(path: string): string | null {
  const parts = path.replace(/^\//, '').split('/');
  return parts[1] || null;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export default async function main(context: AppwriteContext): Promise<void> {
  const { req, res, log, error } = context;

  // Auth: Appwrite runtime injects x-appwrite-user-id from the verified session
  const userId = req.headers['x-appwrite-user-id'];
  if (!userId) {
    return res.json({ error: 'Unauthorized', status: 401 }, 401);
  }

  const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT;
  const apiKey = process.env.APPWRITE_FUNCTION_API_KEY;
  const projectId = process.env.APPWRITE_FUNCTION_PROJECT_ID;

  if (!endpoint || !apiKey || !projectId) {
    error(
      'Missing APPWRITE_FUNCTION_API_ENDPOINT, APPWRITE_FUNCTION_PROJECT_ID, or APPWRITE_FUNCTION_API_KEY',
    );
    return res.json({ error: 'Internal server error', status: 500 }, 500);
  }

  const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  const databases = new Databases(client);

  const { method, path } = req;
  const reminderId = extractId(path);
  const suffix = extractSuffix(path);

  // ---------------------------------------------------------------------------
  // GET / — listReminders
  // ---------------------------------------------------------------------------
  if (method === 'GET' && !reminderId) {
    const updatedSince = req.query['updatedSince'] ? Number(req.query['updatedSince']) : undefined;

    try {
      const filters = [Query.equal('userId', userId)];
      if (updatedSince !== undefined && Number.isFinite(updatedSince)) {
        filters.push(Query.greaterThan('updatedAt', updatedSince));
      }
      const result = await databases.listDocuments(DATABASE_ID, NOTES_COLLECTION, filters);
      // Only return notes that are reminders (have triggerAt)
      const reminders = result.documents
        .filter((d) => d.triggerAt !== null && d.triggerAt !== undefined)
        .map(mapDocToReminder);
      return res.json(reminders);
    } catch (err) {
      error(`listReminders failed: ${String(err)}`);
      return res.json({ error: 'Failed to list reminders', status: 500 }, 500);
    }
  }

  // ---------------------------------------------------------------------------
  // GET /:id — getReminder
  // ---------------------------------------------------------------------------
  if (method === 'GET' && reminderId && !suffix) {
    try {
      const result = await databases.listDocuments(DATABASE_ID, NOTES_COLLECTION, [
        Query.equal('$id', reminderId),
        Query.equal('userId', userId),
      ]);
      const doc = result.documents[0];
      if (!doc) {
        return res.json({ error: 'Reminder not found', status: 404 }, 404);
      }
      return res.json(mapDocToReminder(doc));
    } catch (err) {
      error(`getReminder failed: ${String(err)}`);
      return res.json({ error: 'Failed to get reminder', status: 500 }, 500);
    }
  }

  // ---------------------------------------------------------------------------
  // POST / — createReminder
  // ---------------------------------------------------------------------------
  if (method === 'POST' && !reminderId) {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return res.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    const bodyUserId = body['userId'] as string | undefined;
    if (!bodyUserId) {
      return res.json({ error: 'Missing userId in body', status: 400 }, 400);
    }
    if (bodyUserId !== userId) {
      return res.json({ error: 'Forbidden', status: 403 }, 403);
    }

    const id = (body['id'] as string | undefined) ?? ID.unique();
    const now = Date.now();

    let nextTriggerAt = (body['triggerAt'] as number | undefined) ?? now;
    const repeat = body['repeat'] as RepeatRule | null | undefined;
    const startAt = body['startAt'] as number | null | undefined;
    const baseAtLocal = body['baseAtLocal'] as string | null | undefined;
    const timezone = (body['timezone'] as string | undefined) ?? 'UTC';

    if (repeat && startAt && baseAtLocal) {
      const next = computeNextTrigger(now, startAt, baseAtLocal, repeat, timezone);
      if (next) nextTriggerAt = next;
    }

    const docFields = {
      userId,
      title: (body['title'] as string | null | undefined) ?? null,
      triggerAt: (body['triggerAt'] as number | undefined) ?? now,
      repeatRule: (body['repeatRule'] as string | undefined) ?? 'none',
      repeatConfig: serializeJsonField(body['repeatConfig']),
      repeat: serializeJsonField(repeat ?? null),
      baseAtLocal: baseAtLocal ?? null,
      startAt: startAt ?? null,
      nextTriggerAt,
      lastFiredAt: null,
      lastAcknowledgedAt: null,
      snoozedUntil: (body['snoozedUntil'] as number | null | undefined) ?? null,
      active: Boolean(body['active'] ?? true),
      done: Boolean(body['done'] ?? false),
      isPinned: Boolean(body['isPinned'] ?? false),
      scheduleStatus: (body['scheduleStatus'] as string | undefined) ?? 'unscheduled',
      timezone,
      version: 1,
      updatedAt: (body['updatedAt'] as number | undefined) ?? now,
      createdAt: (body['createdAt'] as number | undefined) ?? now,
    };

    try {
      const created = await databases.createDocument(DATABASE_ID, NOTES_COLLECTION, id, docFields);

      await databases.createDocument(DATABASE_ID, NOTE_CHANGE_EVENTS_COLLECTION, ID.unique(), {
        noteId: id,
        userId,
        operation: 'create',
        changedAt: now,
        deviceId: (body['deviceId'] as string | undefined) ?? 'server',
        payloadHash: '',
      });

      // TODO Phase 5: call push-notification function
      log(`Created reminder ${id}`);
      return res.json(mapDocToReminder(created), 201);
    } catch (err) {
      error(`createReminder failed: ${String(err)}`);
      return res.json({ error: 'Failed to create reminder', status: 500 }, 500);
    }
  }

  // ---------------------------------------------------------------------------
  // PATCH /:id — updateReminder
  // ---------------------------------------------------------------------------
  if (method === 'PATCH' && reminderId && !suffix) {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return res.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    try {
      const existing = await databases.listDocuments(DATABASE_ID, NOTES_COLLECTION, [
        Query.equal('$id', reminderId),
        Query.equal('userId', userId),
      ]);
      const doc = existing.documents[0];
      if (!doc) {
        return res.json({ error: 'Reminder not found', status: 404 }, 404);
      }

      const updatedAt = (body['updatedAt'] as number | undefined) ?? Date.now();
      if (updatedAt <= (doc.updatedAt as number)) {
        // LWW: incoming is older, no-op
        return res.json(mapDocToReminder(doc));
      }

      const patch: Record<string, unknown> = {
        updatedAt,
        version: ((doc.version as number) || 0) + 1,
      };

      const fieldsToCopy = [
        'title',
        'triggerAt',
        'repeatRule',
        'snoozedUntil',
        'active',
        'scheduleStatus',
        'timezone',
        'baseAtLocal',
        'startAt',
        'nextTriggerAt',
        'lastFiredAt',
        'lastAcknowledgedAt',
      ];
      for (const field of fieldsToCopy) {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          patch[field] = body[field];
        }
      }
      if (Object.prototype.hasOwnProperty.call(body, 'repeatConfig')) {
        patch['repeatConfig'] = serializeJsonField(body['repeatConfig']);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'repeat')) {
        patch['repeat'] = serializeJsonField(body['repeat'] as unknown);
      }

      const updated = await databases.updateDocument(
        DATABASE_ID,
        NOTES_COLLECTION,
        reminderId,
        patch,
      );

      await databases.createDocument(DATABASE_ID, NOTE_CHANGE_EVENTS_COLLECTION, ID.unique(), {
        noteId: reminderId,
        userId,
        operation: 'update',
        changedAt: updatedAt,
        deviceId: (body['deviceId'] as string | undefined) ?? 'server',
        payloadHash: '',
      });

      // TODO Phase 5: call push-notification function
      return res.json(mapDocToReminder(updated));
    } catch (err) {
      error(`updateReminder failed: ${String(err)}`);
      return res.json({ error: 'Failed to update reminder', status: 500 }, 500);
    }
  }

  // ---------------------------------------------------------------------------
  // DELETE /:id — deleteReminder
  // ---------------------------------------------------------------------------
  if (method === 'DELETE' && reminderId && !suffix) {
    let bodyDeviceId: string | undefined;
    try {
      const body = JSON.parse(req.body || '{}') as Record<string, unknown>;
      bodyDeviceId = body['deviceId'] as string | undefined;
    } catch {
      // ignore parse error — deviceId is optional
    }

    try {
      const existing = await databases.listDocuments(DATABASE_ID, NOTES_COLLECTION, [
        Query.equal('$id', reminderId),
        Query.equal('userId', userId),
      ]);
      const doc = existing.documents[0];
      if (!doc) {
        return res.json({ error: 'Reminder not found', status: 404 }, 404);
      }

      await databases.deleteDocument(DATABASE_ID, NOTES_COLLECTION, reminderId);

      await databases.createDocument(DATABASE_ID, NOTE_CHANGE_EVENTS_COLLECTION, ID.unique(), {
        noteId: reminderId,
        userId,
        operation: 'delete',
        changedAt: Date.now(),
        deviceId: bodyDeviceId ?? 'server',
        payloadHash: '',
      });

      // TODO Phase 5: call push-notification function
      return res.json({ id: reminderId });
    } catch (err) {
      error(`deleteReminder failed: ${String(err)}`);
      return res.json({ error: 'Failed to delete reminder', status: 500 }, 500);
    }
  }

  // ---------------------------------------------------------------------------
  // POST /:id/ack — ackReminder
  // ---------------------------------------------------------------------------
  if (method === 'POST' && reminderId && suffix === 'ack') {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return res.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    const ackType = body['ackType'] as string | undefined;
    if (!ackType) {
      return res.json({ error: 'Missing ackType in body', status: 400 }, 400);
    }

    try {
      const existing = await databases.listDocuments(DATABASE_ID, NOTES_COLLECTION, [
        Query.equal('$id', reminderId),
        Query.equal('userId', userId),
      ]);
      const doc = existing.documents[0];
      if (!doc) {
        return res.json({ error: 'Reminder not found', status: 404 }, 404);
      }

      const now = Date.now();
      const updates: Record<string, unknown> = {
        updatedAt: now,
        lastAcknowledgedAt: now,
        version: ((doc.version as number) || 0) + 1,
      };

      if (ackType === 'done') {
        updates['done'] = true;
        const repeat = deserializeJsonField(doc.repeat as string | null) as RepeatRule | null;
        const startAt = doc.startAt as number | null;
        const baseAtLocal = doc.baseAtLocal as string | null;
        const hasRecurrence = !!(repeat && startAt && baseAtLocal);

        if (!hasRecurrence && doc.snoozedUntil && (doc.snoozedUntil as number) > now) {
          updates['scheduleStatus'] = 'scheduled';
          updates['nextTriggerAt'] = doc.snoozedUntil;
        } else {
          updates['snoozedUntil'] = null;

          if (hasRecurrence) {
            const next = computeNextTrigger(
              now,
              startAt!,
              baseAtLocal!,
              repeat!,
              (doc.timezone as string | null) ?? 'UTC',
            );

            if (next) {
              updates['nextTriggerAt'] = next;
              updates['lastFiredAt'] = now;
              updates['scheduleStatus'] = 'scheduled';
            } else {
              updates['scheduleStatus'] = 'unscheduled';
              updates['nextTriggerAt'] = null;
            }
          } else {
            updates['scheduleStatus'] = 'unscheduled';
            updates['nextTriggerAt'] = null;
          }
        }
      }

      const updated = await databases.updateDocument(
        DATABASE_ID,
        NOTES_COLLECTION,
        reminderId,
        updates,
      );

      await databases.createDocument(DATABASE_ID, NOTE_CHANGE_EVENTS_COLLECTION, ID.unique(), {
        noteId: reminderId,
        userId,
        operation: 'update',
        changedAt: now,
        deviceId: (body['deviceId'] as string | undefined) ?? 'server',
        payloadHash: '',
      });

      // TODO Phase 5: call push-notification function
      return res.json(mapDocToReminder(updated));
    } catch (err) {
      error(`ackReminder failed: ${String(err)}`);
      return res.json({ error: 'Failed to ack reminder', status: 500 }, 500);
    }
  }

  // ---------------------------------------------------------------------------
  // POST /:id/snooze — snoozeReminder
  // ---------------------------------------------------------------------------
  if (method === 'POST' && reminderId && suffix === 'snooze') {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return res.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    const snoozedUntil = body['snoozedUntil'] as number | undefined;
    if (!snoozedUntil || typeof snoozedUntil !== 'number') {
      return res.json({ error: 'Missing or invalid snoozedUntil in body', status: 400 }, 400);
    }

    try {
      const existing = await databases.listDocuments(DATABASE_ID, NOTES_COLLECTION, [
        Query.equal('$id', reminderId),
        Query.equal('userId', userId),
      ]);
      const doc = existing.documents[0];
      if (!doc) {
        return res.json({ error: 'Reminder not found', status: 404 }, 404);
      }

      const now = Date.now();
      const updates = {
        snoozedUntil,
        nextTriggerAt: snoozedUntil,
        scheduleStatus: 'scheduled',
        active: true,
        updatedAt: now,
        version: ((doc.version as number) || 0) + 1,
      };

      const updated = await databases.updateDocument(
        DATABASE_ID,
        NOTES_COLLECTION,
        reminderId,
        updates,
      );

      await databases.createDocument(DATABASE_ID, NOTE_CHANGE_EVENTS_COLLECTION, ID.unique(), {
        noteId: reminderId,
        userId,
        operation: 'update',
        changedAt: now,
        deviceId: (body['deviceId'] as string | undefined) ?? 'server',
        payloadHash: '',
      });

      // TODO Phase 5: call push-notification function
      return res.json(mapDocToReminder(updated));
    } catch (err) {
      error(`snoozeReminder failed: ${String(err)}`);
      return res.json({ error: 'Failed to snooze reminder', status: 500 }, 500);
    }
  }

  return res.json({ error: 'Method not allowed', status: 405 }, 405);
}
