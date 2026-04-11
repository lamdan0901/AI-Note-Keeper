import { Client, Databases, Query } from 'node-appwrite';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATABASE_ID = 'ai-note-keeper';
const NOTES_COLLECTION = 'notes';
const SUBSCRIPTIONS_COLLECTION = 'subscriptions';
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const PAGE_LIMIT = 500;

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
// Main handler — ported from convex/functions/notes.purgeExpiredTrash
//                          and convex/functions/subscriptions.purgeExpiredSubscriptionTrash
// ---------------------------------------------------------------------------

export default async function main(context: AppwriteContext): Promise<void> {
  const { res, log, error } = context;

  const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT;
  const apiKey = process.env.APPWRITE_FUNCTION_API_KEY;
  const projectId = process.env.APPWRITE_FUNCTION_PROJECT_ID;

  if (!endpoint || !apiKey || !projectId) {
    error(
      'Missing APPWRITE_FUNCTION_API_ENDPOINT, APPWRITE_FUNCTION_PROJECT_ID, or APPWRITE_FUNCTION_API_KEY',
    );
    return res.json({ error: 'Internal server error' }, 500);
  }

  const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  const databases = new Databases(client);

  const cutoff = Date.now() - FOURTEEN_DAYS_MS;
  log(`[PurgeTrash] Cutoff: ${new Date(cutoff).toISOString()}`);

  const notesPurged = await purgeCollection(databases, NOTES_COLLECTION, cutoff, log, error);
  const subscriptionsPurged = await purgeCollection(
    databases,
    SUBSCRIPTIONS_COLLECTION,
    cutoff,
    log,
    error,
  );

  log(
    `[PurgeTrash] Done. Notes purged: ${notesPurged}, Subscriptions purged: ${subscriptionsPurged}`,
  );
  return res.json({ notesPurged, subscriptionsPurged });
}

// ---------------------------------------------------------------------------
// Paginated delete of expired soft-deleted documents
// ---------------------------------------------------------------------------

async function purgeCollection(
  databases: Databases,
  collectionId: string,
  cutoff: number,
  log: (msg: string) => void,
  error: (msg: string) => void,
): Promise<number> {
  let purged = 0;

  for (;;) {
    let docs: { $id: string }[];
    try {
      const result = await databases.listDocuments(DATABASE_ID, collectionId, [
        Query.equal('active', false),
        Query.lessThan('deletedAt', cutoff),
        Query.limit(PAGE_LIMIT),
      ]);
      docs = result.documents as unknown as { $id: string }[];
    } catch (err) {
      error(`[PurgeTrash] Failed to list ${collectionId}: ${String(err)}`);
      break;
    }

    if (docs.length === 0) break;

    for (const doc of docs) {
      try {
        await databases.deleteDocument(DATABASE_ID, collectionId, doc.$id);
        purged++;
      } catch (err) {
        error(`[PurgeTrash] Failed to delete ${collectionId}/${doc.$id}: ${String(err)}`);
      }
    }

    log(`[PurgeTrash] Purged ${purged} ${collectionId} documents so far`);

    // Stop if we got a partial page — no more expired documents
    if (docs.length < PAGE_LIMIT) break;
  }

  return purged;
}
