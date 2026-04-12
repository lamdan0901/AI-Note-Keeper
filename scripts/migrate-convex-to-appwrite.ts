/// <reference types="node" />
/**
 * scripts/migrate-convex-to-appwrite.ts
 *
 * One-time migration script: reads Convex JSONL export files and bulk-imports
 * all data into Appwrite (Auth users + database documents).
 *
 * PRE-REQUISITE (manual step before running):
 *   npx convex export --prod --path scripts/migration-data/
 *   # Produces (one file per table):
 *     scripts/migration-data/users.jsonl
 *     scripts/migration-data/notes.jsonl
 *     scripts/migration-data/noteChangeEvents.jsonl
 *     scripts/migration-data/subscriptions.jsonl
 *     scripts/migration-data/devicePushTokens.jsonl
 *
 * Required env vars:
 *   APPWRITE_ENDPOINT      e.g. https://cloud.appwrite.io/v1
 *   APPWRITE_PROJECT_ID
 *   APPWRITE_API_KEY       Admin key with users.write + databases.write scopes
 *
 * Usage:
 *   npm run migrate-convex-to-appwrite
 */

import * as fs from 'fs';
import * as path from 'path';
import { Client, Databases, ID, Query, Users } from 'node-appwrite';

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

const DATA_DIR = path.join(__dirname, 'migration-data');
const USER_ID_MAP_PATH = path.join(DATA_DIR, 'user-id-map.json');
const REPORT_PATH = path.join(DATA_DIR, 'migration-report.json');

const BATCH_SIZE = 25;
const BATCH_PAUSE_MS = 100;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSyntheticEmail(username: string): string {
  return `${username}@app.notekeeper.local`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJsonl(filePath: string): Record<string, unknown>[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, idx) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        throw new Error(`Invalid JSON on line ${idx + 1} of ${filePath}`);
      }
    });
}

function requireFile(filePath: string, label: string): void {
  if (!fs.existsSync(filePath)) {
    console.error(`  ✗ Missing required file: ${filePath}`);
    console.error(`    Run: npx convex export --prod --path scripts/migration-data/`);
    console.error(`    Then re-run this script.`);
    throw new Error(`Missing ${label} export file`);
  }
}

/**
 * Process items in batches of BATCH_SIZE concurrently.
 * fn must return true (imported), false (orphaned/skipped), or throw (error).
 * Returns counts of succeeded (imported) and skipped (orphaned + errored) items.
 */
async function batchProcess<T>(
  items: T[],
  fn: (item: T) => Promise<boolean>,
): Promise<{ succeeded: number; skipped: number }> {
  let succeeded = 0;
  let skipped = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((item) => fn(item)));

    for (const result of results) {
      if (result.status === 'fulfilled') {
        if (result.value) {
          succeeded++;
        } else {
          skipped++; // orphaned row — userId not in map
        }
      } else {
        skipped++;
        console.warn('  ⚠ item failed:', (result.reason as Error).message ?? result.reason);
      }
    }

    if (i + BATCH_SIZE < items.length) {
      await sleep(BATCH_PAUSE_MS);
    }
  }

  return { succeeded, skipped };
}

// ---------------------------------------------------------------------------
// Phase B — Create Appwrite Auth users
// ---------------------------------------------------------------------------

async function phaseB(userRows: Record<string, unknown>[]): Promise<Map<string, string>> {
  console.log('\n[Phase B] Creating Appwrite Auth users…');

  // Merge with any existing map from a prior partial run so rollback stays complete.
  const existingRaw: Record<string, string> = fs.existsSync(USER_ID_MAP_PATH)
    ? (JSON.parse(fs.readFileSync(USER_ID_MAP_PATH, 'utf-8')) as Record<string, string>)
    : {};
  const userIdMap = new Map<string, string>(Object.entries(existingRaw));
  if (userIdMap.size > 0) {
    console.log(`  ↺ Resuming — ${userIdMap.size} users already mapped from prior run`);
  }

  const { succeeded, skipped } = await batchProcess(userRows, async (row) => {
    const convexId = row['_id'] as string;
    const username = row['username'] as string;

    if (!convexId || !username) {
      throw new Error(`User row missing _id or username: ${JSON.stringify(row)}`);
    }

    // Already mapped from a prior run — skip creation, preserve existing mapping.
    if (userIdMap.has(convexId)) {
      return false;
    }

    const appwriteUser = await users.create(
      ID.unique(),
      toSyntheticEmail(username),
      undefined,
      undefined,
      username,
    );
    await users.updateLabels(appwriteUser.$id, ['migrated']);
    userIdMap.set(convexId, appwriteUser.$id);
    return true;
  });

  // Atomic write via temp-file + rename to avoid partial-write corruption.
  const tmpPath = `${USER_ID_MAP_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(Object.fromEntries(userIdMap), null, 2));
  fs.renameSync(tmpPath, USER_ID_MAP_PATH);
  console.log(
    `  ✓ Created ${succeeded} users, ${skipped} already mapped/skipped. Map written to ${USER_ID_MAP_PATH}`,
  );

  return userIdMap;
}

// ---------------------------------------------------------------------------
// Phase C — Import notes
// ---------------------------------------------------------------------------

async function phaseC(
  noteRows: Record<string, unknown>[],
  userIdMap: Map<string, string>,
): Promise<{ jsonlCount: number; succeeded: number; skipped: number }> {
  console.log('\n[Phase C] Importing notes…');
  const jsonlCount = noteRows.length;

  const { succeeded, skipped } = await batchProcess(noteRows, async (row) => {
    const convexUserId = row['userId'] as string;
    const appwriteUserId = userIdMap.get(convexUserId);
    if (!appwriteUserId) return false; // orphaned — user not migrated

    const noteId = row['id'] as string;
    if (!noteId) throw new Error(`Note row missing id: ${JSON.stringify(row)}`);

    const repeat = row['repeat'];
    const repeatConfig = row['repeatConfig'];

    const payload: Record<string, unknown> = {
      id: noteId,
      userId: appwriteUserId,
      title: row['title'] ?? null,
      content: row['content'] ?? null,
      contentType: row['contentType'] ?? null,
      color: row['color'] ?? null,
      active: row['active'],
      done: row['done'] ?? false,
      isPinned: row['isPinned'] ?? false,
      triggerAt: row['triggerAt'] ?? null,
      repeatRule: row['repeatRule'] ?? null,
      repeatConfig:
        repeatConfig !== undefined && repeatConfig !== null
          ? typeof repeatConfig === 'string'
            ? repeatConfig
            : JSON.stringify(repeatConfig)
          : null,
      repeat:
        repeat !== undefined && repeat !== null
          ? typeof repeat === 'string'
            ? repeat
            : JSON.stringify(repeat)
          : null,
      snoozedUntil: row['snoozedUntil'] ?? null,
      scheduleStatus: row['scheduleStatus'] ?? null,
      timezone: row['timezone'] ?? null,
      baseAtLocal: row['baseAtLocal'] ?? null,
      startAt: row['startAt'] ?? null,
      nextTriggerAt: row['nextTriggerAt'] ?? null,
      lastFiredAt: row['lastFiredAt'] ?? null,
      lastAcknowledgedAt: row['lastAcknowledgedAt'] ?? null,
      version: row['version'] ?? 0,
      deletedAt: row['deletedAt'] ?? null,
      updatedAt: row['updatedAt'],
      createdAt: row['createdAt'],
    };

    // Remove null values for optional fields Appwrite won't accept as null
    for (const key of Object.keys(payload)) {
      if (payload[key] === null || payload[key] === undefined) {
        delete payload[key];
      }
    }

    await db.createDocument(DATABASE_ID, NOTES_COLLECTION, noteId, payload);
    return true;
  });

  console.log(`  ✓ ${succeeded} imported, ${skipped} skipped (orphaned or error)`);
  return { jsonlCount, succeeded, skipped };
}

// ---------------------------------------------------------------------------
// Phase D — Import noteChangeEvents
// ---------------------------------------------------------------------------

async function phaseD(
  eventRows: Record<string, unknown>[],
  userIdMap: Map<string, string>,
): Promise<{ jsonlCount: number; succeeded: number; skipped: number }> {
  console.log('\n[Phase D] Importing noteChangeEvents…');
  const jsonlCount = eventRows.length;

  const { succeeded, skipped } = await batchProcess(eventRows, async (row) => {
    const convexUserId = row['userId'] as string;
    const appwriteUserId = userIdMap.get(convexUserId);
    if (!appwriteUserId) return false; // orphaned

    const eventId = row['id'] as string;
    if (!eventId) throw new Error(`NoteChangeEvent row missing id: ${JSON.stringify(row)}`);

    const payload: Record<string, unknown> = {
      id: eventId,
      noteId: row['noteId'],
      userId: appwriteUserId,
      operation: row['operation'],
      changedAt: row['changedAt'],
      deviceId: row['deviceId'] ?? null,
      payloadHash: row['payloadHash'] ?? null,
    };

    for (const key of Object.keys(payload)) {
      if (payload[key] === null || payload[key] === undefined) {
        delete payload[key];
      }
    }

    await db.createDocument(DATABASE_ID, NOTE_CHANGE_EVENTS_COLLECTION, eventId, payload);
    return true;
  });

  console.log(`  ✓ ${succeeded} imported, ${skipped} skipped`);
  return { jsonlCount, succeeded, skipped };
}

// ---------------------------------------------------------------------------
// Phase E — Import subscriptions
// ---------------------------------------------------------------------------

async function phaseE(
  subRows: Record<string, unknown>[],
  userIdMap: Map<string, string>,
): Promise<{ jsonlCount: number; succeeded: number; skipped: number }> {
  console.log('\n[Phase E] Importing subscriptions…');
  const jsonlCount = subRows.length;

  const { succeeded, skipped } = await batchProcess(subRows, async (row) => {
    const convexUserId = row['userId'] as string;
    const appwriteUserId = userIdMap.get(convexUserId);
    if (!appwriteUserId) return false; // orphaned

    const reminderDaysBefore = row['reminderDaysBefore'];
    const reminderDaysStr =
      reminderDaysBefore !== undefined && reminderDaysBefore !== null
        ? typeof reminderDaysBefore === 'string'
          ? reminderDaysBefore
          : JSON.stringify(reminderDaysBefore)
        : '[]';

    const payload: Record<string, unknown> = {
      userId: appwriteUserId,
      serviceName: row['serviceName'],
      category: row['category'] ?? null,
      price: row['price'],
      currency: row['currency'],
      billingCycle: row['billingCycle'],
      billingCycleCustomDays: row['billingCycleCustomDays'] ?? null,
      notes: row['notes'] ?? null,
      nextBillingDate: row['nextBillingDate'],
      trialEndDate: row['trialEndDate'] ?? null,
      status: row['status'],
      reminderDaysBefore: reminderDaysStr,
      nextReminderAt: row['nextReminderAt'] ?? null,
      lastNotifiedBillingDate: row['lastNotifiedBillingDate'] ?? null,
      nextTrialReminderAt: row['nextTrialReminderAt'] ?? null,
      lastNotifiedTrialEndDate: row['lastNotifiedTrialEndDate'] ?? null,
      active: row['active'],
      deletedAt: row['deletedAt'] ?? null,
      createdAt: row['createdAt'],
      updatedAt: row['updatedAt'],
    };

    for (const key of Object.keys(payload)) {
      if (payload[key] === null || payload[key] === undefined) {
        delete payload[key];
      }
    }

    await db.createDocument(DATABASE_ID, SUBSCRIPTIONS_COLLECTION, ID.unique(), payload);
    return true;
  });

  console.log(`  ✓ ${succeeded} imported, ${skipped} skipped`);
  return { jsonlCount, succeeded, skipped };
}

// ---------------------------------------------------------------------------
// Phase F — Import devicePushTokens
// ---------------------------------------------------------------------------

async function phaseF(
  tokenRows: Record<string, unknown>[],
  userIdMap: Map<string, string>,
): Promise<{ jsonlCount: number; succeeded: number; skipped: number }> {
  console.log('\n[Phase F] Importing devicePushTokens…');
  const jsonlCount = tokenRows.length;

  const { succeeded, skipped } = await batchProcess(tokenRows, async (row) => {
    const convexUserId = row['userId'] as string;
    const appwriteUserId = userIdMap.get(convexUserId);
    if (!appwriteUserId) return false; // orphaned

    const tokenId = typeof row['id'] === 'string' && row['id'] ? row['id'] : ID.unique();

    const payload: Record<string, unknown> = {
      userId: appwriteUserId,
      deviceId: row['deviceId'],
      fcmToken: row['fcmToken'],
      platform: row['platform'],
      updatedAt: row['updatedAt'],
    };

    await db.createDocument(DATABASE_ID, DEVICE_PUSH_TOKENS_COLLECTION, tokenId, payload);
    return true;
  });

  console.log(`  ✓ ${succeeded} imported, ${skipped} skipped`);
  return { jsonlCount, succeeded, skipped };
}

// ---------------------------------------------------------------------------
// Phase G — Validation report
// ---------------------------------------------------------------------------

type CollectionReport = {
  jsonlLines: number;
  appwriteTotal: number;
};

type MigrationReport = {
  migratedAt: string;
  users: { jsonlLines: number; appwriteTotal: number };
  notes: CollectionReport;
  noteChangeEvents: CollectionReport;
  subscriptions: CollectionReport;
  devicePushTokens: CollectionReport;
};

async function phaseG(jsonlCounts: {
  users: number;
  notes: { jsonlCount: number; succeeded: number; skipped: number };
  noteChangeEvents: { jsonlCount: number; succeeded: number; skipped: number };
  subscriptions: { jsonlCount: number; succeeded: number; skipped: number };
  devicePushTokens: { jsonlCount: number; succeeded: number; skipped: number };
}): Promise<void> {
  console.log('\n[Phase G] Validation report…');

  async function getCollectionCount(
    collectionId: string,
    jsonlCount: number,
  ): Promise<CollectionReport> {
    const result = await db.listDocuments(DATABASE_ID, collectionId, [Query.limit(1)]);
    return { jsonlLines: jsonlCount, appwriteTotal: result.total };
  }

  const [notesStats, eventsStats, subsStats, tokensStats, authUserList] = await Promise.all([
    getCollectionCount(NOTES_COLLECTION, jsonlCounts.notes.jsonlCount),
    getCollectionCount(NOTE_CHANGE_EVENTS_COLLECTION, jsonlCounts.noteChangeEvents.jsonlCount),
    getCollectionCount(SUBSCRIPTIONS_COLLECTION, jsonlCounts.subscriptions.jsonlCount),
    getCollectionCount(DEVICE_PUSH_TOKENS_COLLECTION, jsonlCounts.devicePushTokens.jsonlCount),
    users.list([Query.limit(1)]),
  ]);

  // Report written to disk contains only counts — no raw document data.
  const report: MigrationReport = {
    migratedAt: new Date().toISOString(),
    users: {
      jsonlLines: jsonlCounts.users,
      appwriteTotal: authUserList.total,
    },
    notes: notesStats,
    noteChangeEvents: eventsStats,
    subscriptions: subsStats,
    devicePushTokens: tokensStats,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log('\n  ┌─ Migration Summary ─────────────────────────────────────────');
  console.log(
    `  │ users            JSONL: ${jsonlCounts.users}  →  Appwrite Auth: ${authUserList.total}`,
  );
  console.log(
    `  │ notes            JSONL: ${notesStats.jsonlLines}  →  Appwrite: ${notesStats.appwriteTotal}  (skipped: ${jsonlCounts.notes.skipped})`,
  );
  console.log(
    `  │ noteChangeEvents JSONL: ${eventsStats.jsonlLines}  →  Appwrite: ${eventsStats.appwriteTotal}  (skipped: ${jsonlCounts.noteChangeEvents.skipped})`,
  );
  console.log(
    `  │ subscriptions    JSONL: ${subsStats.jsonlLines}  →  Appwrite: ${subsStats.appwriteTotal}  (skipped: ${jsonlCounts.subscriptions.skipped})`,
  );
  console.log(
    `  │ devicePushTokens JSONL: ${tokensStats.jsonlLines}  →  Appwrite: ${tokensStats.appwriteTotal}  (skipped: ${jsonlCounts.devicePushTokens.skipped})`,
  );
  console.log('  └────────────────────────────────────────────────────────────');
  console.log(`\n  Report written to ${REPORT_PATH}`);

  // Spot-check: console-only — do NOT include raw document data in the written report.
  console.log('\n  Spot-check (first 3 docs per collection):');
  for (const [label, collectionId] of [
    ['notes', NOTES_COLLECTION],
    ['noteChangeEvents', NOTE_CHANGE_EVENTS_COLLECTION],
    ['subscriptions', SUBSCRIPTIONS_COLLECTION],
    ['devicePushTokens', DEVICE_PUSH_TOKENS_COLLECTION],
  ] as [string, string][]) {
    const sampleResult = await db.listDocuments(DATABASE_ID, collectionId, [Query.limit(3)]);
    console.log(`\n  [${label}]`);
    for (const doc of sampleResult.documents) {
      console.log(`    $id=${doc.$id}  userId=${(doc as Record<string, unknown>)['userId']}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Convex → Appwrite Migration\n');

  // Validate data directory and required files
  if (!fs.existsSync(DATA_DIR)) {
    console.error(`Data directory not found: ${DATA_DIR}`);
    console.error('Run: npx convex export --prod --path scripts/migration-data/');
    process.exit(1);
  }

  const requiredFiles: [string, string][] = [
    [path.join(DATA_DIR, 'users.jsonl'), 'users'],
    [path.join(DATA_DIR, 'notes.jsonl'), 'notes'],
    [path.join(DATA_DIR, 'noteChangeEvents.jsonl'), 'noteChangeEvents'],
    [path.join(DATA_DIR, 'subscriptions.jsonl'), 'subscriptions'],
    [path.join(DATA_DIR, 'devicePushTokens.jsonl'), 'devicePushTokens'],
  ];

  for (const [filePath, label] of requiredFiles) {
    requireFile(filePath, label);
  }

  console.log('Reading JSONL export files…');
  const userRows = readJsonl(path.join(DATA_DIR, 'users.jsonl'));
  const noteRows = readJsonl(path.join(DATA_DIR, 'notes.jsonl'));
  const eventRows = readJsonl(path.join(DATA_DIR, 'noteChangeEvents.jsonl'));
  const subRows = readJsonl(path.join(DATA_DIR, 'subscriptions.jsonl'));
  const tokenRows = readJsonl(path.join(DATA_DIR, 'devicePushTokens.jsonl'));

  console.log(`  users: ${userRows.length}`);
  console.log(`  notes: ${noteRows.length}`);
  console.log(`  noteChangeEvents: ${eventRows.length}`);
  console.log(`  subscriptions: ${subRows.length}`);
  console.log(`  devicePushTokens: ${tokenRows.length}`);

  // Phase B: Create Auth users
  const userIdMap = await phaseB(userRows);

  // Phases C–F: Import documents
  const notesResult = await phaseC(noteRows, userIdMap);
  const eventsResult = await phaseD(eventRows, userIdMap);
  const subsResult = await phaseE(subRows, userIdMap);
  const tokensResult = await phaseF(tokenRows, userIdMap);

  // Phase G: Validation report
  await phaseG({
    users: userRows.length,
    notes: notesResult,
    noteChangeEvents: eventsResult,
    subscriptions: subsResult,
    devicePushTokens: tokensResult,
  });

  console.log('\n✅ Migration complete.');
}

main().catch((err) => {
  console.error('\nFatal error during migration:', err);
  process.exit(1);
});
