/// <reference types="node" />
/**
 * scripts/rollback-appwrite-migration.ts
 *
 * Rollback script for the Convex → Appwrite migration.
 * Reads the user-id-map.json produced by migrate-convex-to-appwrite.ts and:
 *   1. Deletes all migrated documents (notes, noteChangeEvents, subscriptions, devicePushTokens)
 *   2. Deletes each Appwrite Auth user
 *
 * Usage:
 *   npm run rollback-appwrite-migration
 *
 * Required env vars:
 *   APPWRITE_ENDPOINT
 *   APPWRITE_PROJECT_ID
 *   APPWRITE_API_KEY   (needs users.write + databases.write scopes)
 */

import * as fs from 'fs';
import * as path from 'path';
import { Client, Databases, Query, Users } from 'node-appwrite';

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const endpoint = process.env.APPWRITE_ENDPOINT;
const projectId = process.env.APPWRITE_PROJECT_ID;
const apiKey = process.env.APPWRITE_API_KEY;

if (!endpoint || !projectId || !apiKey) {
  console.error(
    'Missing required env vars: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY',
  );
  process.exit(1);
}

const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
const db = new Databases(client);
const users = new Users(client);

const DATABASE_ID = 'ai-note-keeper';
const NOTES_COLLECTION = 'notes';
const NOTE_CHANGE_EVENTS_COLLECTION = 'noteChangeEvents';
const SUBSCRIPTIONS_COLLECTION = 'subscriptions';
const DEVICE_PUSH_TOKENS_COLLECTION = 'devicePushTokens';

const USER_ID_MAP_PATH = path.join(__dirname, 'migration-data', 'user-id-map.json');
const PAGE_LIMIT = 100;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Paginate through all documents for a given userId and delete them.
 * Returns the number of documents deleted.
 */
async function deleteAllDocumentsForUser(
  collectionId: string,
  appwriteUserId: string,
): Promise<number> {
  let deleted = 0;

  for (;;) {
    const result = await db.listDocuments(DATABASE_ID, collectionId, [
      Query.equal('userId', appwriteUserId),
      Query.limit(PAGE_LIMIT),
    ]);

    if (result.documents.length === 0) break;

    await Promise.all(
      result.documents.map((doc) => db.deleteDocument(DATABASE_ID, collectionId, doc.$id)),
    );
    deleted += result.documents.length;

    if (result.documents.length < PAGE_LIMIT) break;

    // Small pause to avoid hammering the API
    await sleep(100);
  }

  return deleted;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Convex → Appwrite Migration ROLLBACK\n');

  if (!fs.existsSync(USER_ID_MAP_PATH)) {
    console.error(`user-id-map.json not found at: ${USER_ID_MAP_PATH}`);
    console.error('Cannot rollback — migration user map is missing.');
    process.exit(1);
  }

  const rawMap = JSON.parse(fs.readFileSync(USER_ID_MAP_PATH, 'utf-8')) as Record<string, string>;
  const appwriteUserIds = Object.values(rawMap);

  if (appwriteUserIds.length === 0) {
    console.log('user-id-map.json is empty — nothing to rollback.');
    process.exit(0);
  }

  console.log(`Found ${appwriteUserIds.length} migrated users to rollback.\n`);

  const collections = [
    NOTES_COLLECTION,
    NOTE_CHANGE_EVENTS_COLLECTION,
    SUBSCRIPTIONS_COLLECTION,
    DEVICE_PUSH_TOKENS_COLLECTION,
  ];

  const deletionCounts: Record<string, number> = {
    [NOTES_COLLECTION]: 0,
    [NOTE_CHANGE_EVENTS_COLLECTION]: 0,
    [SUBSCRIPTIONS_COLLECTION]: 0,
    [DEVICE_PUSH_TOKENS_COLLECTION]: 0,
    users: 0,
  };

  for (const appwriteUserId of appwriteUserIds) {
    console.log(`Rolling back user ${appwriteUserId}…`);

    // Delete documents across all collections for this user
    for (const collectionId of collections) {
      const count = await deleteAllDocumentsForUser(collectionId, appwriteUserId);
      deletionCounts[collectionId] += count;
    }

    // Delete the Auth user
    try {
      await users.delete(appwriteUserId);
      deletionCounts['users']++;
    } catch (err: unknown) {
      const code = (err as { code?: number }).code;
      if (code === 404) {
        console.warn(`  ⚠ User ${appwriteUserId} not found in Auth (already deleted?)`);
      } else {
        throw err;
      }
    }
  }

  console.log('\n  ┌─ Rollback Summary ──────────────────────────────────────────');
  console.log(`  │ users deleted            : ${deletionCounts['users']}`);
  console.log(`  │ notes deleted            : ${deletionCounts[NOTES_COLLECTION]}`);
  console.log(`  │ noteChangeEvents deleted : ${deletionCounts[NOTE_CHANGE_EVENTS_COLLECTION]}`);
  console.log(`  │ subscriptions deleted    : ${deletionCounts[SUBSCRIPTIONS_COLLECTION]}`);
  console.log(`  │ devicePushTokens deleted : ${deletionCounts[DEVICE_PUSH_TOKENS_COLLECTION]}`);
  console.log('  └────────────────────────────────────────────────────────────');

  console.log('\n✅ Rollback complete.');
}

main().catch((err) => {
  console.error('\nFatal error during rollback:', err);
  process.exit(1);
});
