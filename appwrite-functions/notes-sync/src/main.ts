import { Client, Databases, ID, Permission, Query, Role } from 'node-appwrite';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATABASE_ID = 'ai-note-keeper';
const NOTES_COLLECTION = 'notes';
const NOTE_CHANGE_EVENTS_COLLECTION = 'noteChangeEvents';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RepeatRule =
  | { kind: 'daily'; interval: number }
  | { kind: 'weekly'; interval: number; weekdays: number[] }
  | { kind: 'monthly'; interval: number; mode: 'day_of_month' }
  | { kind: 'custom'; interval: number; frequency: 'minutes' | 'days' | 'weeks' | 'months' };

interface SyncNoteChange {
  id: string;
  userId: string;
  title?: string;
  content?: string;
  contentType?: string;
  color?: string;
  active: boolean;
  done?: boolean;
  isPinned?: boolean;
  triggerAt?: number;
  repeatRule?: string;
  repeatConfig?: Record<string, unknown> | null;
  repeat?: RepeatRule | null;
  baseAtLocal?: string | null;
  startAt?: number | null;
  nextTriggerAt?: number | null;
  lastFiredAt?: number | null;
  lastAcknowledgedAt?: number | null;
  snoozedUntil?: number;
  scheduleStatus?: string;
  timezone?: string;
  deletedAt?: number;
  updatedAt: number;
  createdAt: number;
  operation: 'create' | 'update' | 'delete';
  deviceId: string;
  version?: number;
  baseVersion?: number;
}

interface SyncRequest {
  userId: string;
  changes: SyncNoteChange[];
  lastSyncAt: number;
}

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

function userDocumentPermissions(userId: string): string[] {
  return [Permission.read(Role.user(userId)), Permission.write(Role.user(userId))];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDocToNote(doc: Record<string, any>) {
  return {
    id: doc.$id as string,
    userId: doc.userId as string,
    title: doc.title ?? null,
    content: doc.content ?? null,
    contentType: doc.contentType ?? null,
    color: doc.color ?? null,
    active: Boolean(doc.active),
    done: Boolean(doc.done),
    isPinned: Boolean(doc.isPinned),
    triggerAt: doc.triggerAt ?? null,
    repeatRule: doc.repeatRule ?? null,
    repeatConfig: deserializeJsonField(doc.repeatConfig),
    repeat: deserializeJsonField(doc.repeat as string | null),
    baseAtLocal: doc.baseAtLocal ?? null,
    startAt: doc.startAt ?? null,
    nextTriggerAt: doc.nextTriggerAt ?? null,
    lastFiredAt: doc.lastFiredAt ?? null,
    lastAcknowledgedAt: doc.lastAcknowledgedAt ?? null,
    snoozedUntil: doc.snoozedUntil ?? null,
    scheduleStatus: doc.scheduleStatus ?? null,
    timezone: doc.timezone ?? null,
    version: doc.version ?? 0,
    deletedAt: doc.deletedAt ?? null,
    updatedAt: doc.updatedAt as number,
    createdAt: doc.createdAt as number,
  };
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

  // Route: GET /notes?userId=
  if (req.method === 'GET') {
    const queryUserId = req.query['userId'];
    if (!queryUserId) {
      return res.json({ error: 'Missing userId query parameter', status: 400 }, 400);
    }
    if (queryUserId !== userId) {
      return res.json({ error: 'Forbidden', status: 403 }, 403);
    }

    try {
      const result = await databases.listDocuments(DATABASE_ID, NOTES_COLLECTION, [
        Query.equal('userId', userId),
      ]);
      const notes = result.documents.map(mapDocToNote);
      return res.json({ notes, syncedAt: Date.now() });
    } catch (err) {
      error(`getNotes failed: ${String(err)}`);
      return res.json({ error: 'Failed to fetch notes', status: 500 }, 500);
    }
  }

  // Route: POST / (syncNotes)
  if (req.method === 'POST') {
    let body: SyncRequest;
    try {
      body = JSON.parse(req.body) as SyncRequest;
    } catch {
      return res.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    const { userId: bodyUserId, changes } = body;

    if (!bodyUserId) {
      return res.json({ error: 'Missing userId in body', status: 400 }, 400);
    }
    if (bodyUserId !== userId) {
      return res.json({ error: 'Forbidden: userId mismatch', status: 403 }, 403);
    }
    if (!Array.isArray(changes)) {
      return res.json({ error: 'changes must be an array', status: 400 }, 400);
    }

    log(`Processing ${changes.length} note changes for user ${userId}`);

    for (const change of changes) {
      const { operation, id } = change;

      // Emit change event
      try {
        await databases.createDocument(
          DATABASE_ID,
          NOTE_CHANGE_EVENTS_COLLECTION,
          ID.unique(),
          {
            noteId: id,
            userId,
            operation,
            changedAt: Date.now(),
            deviceId: change.deviceId ?? 'server',
            payloadHash: '',
          },
          userDocumentPermissions(userId),
        );
      } catch (err) {
        log(`Failed to write change event for ${id}: ${String(err)}`);
      }

      // Fetch existing document
      let existing: Record<string, unknown> | null = null;
      try {
        const result = await databases.listDocuments(DATABASE_ID, NOTES_COLLECTION, [
          Query.equal('userId', userId),
          Query.equal('$id', id),
        ]);
        existing = result.documents[0] ?? null;
      } catch (err) {
        log(`Failed to fetch existing note ${id}: ${String(err)}`);
      }

      if (operation === 'delete') {
        if (existing) {
          try {
            await databases.updateDocument(DATABASE_ID, NOTES_COLLECTION, id, {
              active: false,
              deletedAt: change.deletedAt ?? Date.now(),
              updatedAt: change.updatedAt,
              version: ((existing.version as number) || 0) + 1,
            });
          } catch (err) {
            error(`Failed to soft-delete note ${id}: ${String(err)}`);
          }
        }
      } else {
        const noteFields = {
          title: change.title ?? null,
          content: change.content ?? null,
          contentType: change.contentType ?? null,
          color: change.color ?? null,
          active: change.active,
          done: change.done ?? false,
          isPinned: change.isPinned ?? false,
          triggerAt: change.triggerAt ?? null,
          repeatRule: change.repeatRule ?? null,
          repeatConfig: serializeJsonField(change.repeatConfig),
          repeat: serializeJsonField(change.repeat),
          baseAtLocal: change.baseAtLocal ?? null,
          startAt: change.startAt ?? null,
          nextTriggerAt: change.nextTriggerAt ?? null,
          lastFiredAt: change.lastFiredAt ?? null,
          lastAcknowledgedAt: change.lastAcknowledgedAt ?? null,
          snoozedUntil: change.snoozedUntil ?? null,
          scheduleStatus: change.scheduleStatus ?? null,
          timezone: change.timezone ?? null,
          updatedAt: change.updatedAt,
          createdAt: change.createdAt,
          deletedAt: change.deletedAt ?? null,
          userId,
        };

        if (existing) {
          // Last-Write-Wins: only update if incoming is newer
          if (change.updatedAt > (existing.updatedAt as number)) {
            try {
              await databases.updateDocument(DATABASE_ID, NOTES_COLLECTION, id, {
                ...noteFields,
                version: ((existing.version as number) || 0) + 1,
              });
            } catch (err) {
              error(`Failed to update note ${id}: ${String(err)}`);
            }
          }
        } else {
          try {
            await databases.createDocument(
              DATABASE_ID,
              NOTES_COLLECTION,
              id,
              {
                ...noteFields,
                version: 1,
              },
              userDocumentPermissions(userId),
            );
          } catch (err) {
            error(`Failed to create note ${id}: ${String(err)}`);
          }
        }
      }
    }

    // Return canonical state
    try {
      const result = await databases.listDocuments(DATABASE_ID, NOTES_COLLECTION, [
        Query.equal('userId', userId),
      ]);
      const notes = result.documents.map(mapDocToNote);
      return res.json({ notes, syncedAt: Date.now() });
    } catch (err) {
      error(`Failed to fetch canonical state: ${String(err)}`);
      return res.json({ error: 'Failed to fetch notes after sync', status: 500 }, 500);
    }
  }

  return res.json({ error: 'Method not allowed', status: 405 }, 405);
}
