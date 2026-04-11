/**
 * scripts/setup-appwrite-schema.ts
 *
 * Idempotent schema setup for the Appwrite `ai-note-keeper` database.
 * Safe to run multiple times — existing collections/attributes are skipped (409).
 *
 * Required env vars:
 *   APPWRITE_ENDPOINT      e.g. https://cloud.appwrite.io/v1
 *   APPWRITE_PROJECT_ID
 *   APPWRITE_API_KEY       Admin API key with databases.write scope
 *
 * Usage:
 *   npm run setup-appwrite-schema
 *
 * Reset mode (deletes then recreates every collection — USE WITH CARE):
 *   npm run setup-appwrite-schema -- --reset
 *
 * String size budget (Appwrite sums all VARCHAR sizes × 4 bytes for utf8mb4,
 * limit ~65535 bytes per collection). Strings > 65535 chars use TEXT and are
 * excluded from the count. Content (100000) intentionally exceeds that
 * threshold to use TEXT storage.
 */

import { Client, Databases, IndexType } from 'node-appwrite';

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const endpoint = process.env.APPWRITE_ENDPOINT;
const projectId = process.env.APPWRITE_PROJECT_ID;
const apiKey = process.env.APPWRITE_API_KEY;

if (!endpoint || !projectId || !apiKey) {
  console.error(
    'Missing required environment variables: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY',
  );
  process.exit(1);
}

const RESET = process.argv.includes('--reset');

const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
const db = new Databases(client);

const DATABASE_ID = 'ai-note-keeper';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function safeRun<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const result = await fn();
    console.log(`  ✓ ${label}`);
    return result;
  } catch (err: unknown) {
    const code = (err as { code?: number }).code;
    if (code === 409) {
      console.log(`  - ${label} (already exists, skipped)`);
      return null;
    }
    if (code === 404) {
      console.log(`  - ${label} (not found, skipped)`);
      return null;
    }
    console.error(`  ✗ ${label}`, err);
    throw err;
  }
}

async function createStringAttr(
  collectionId: string,
  key: string,
  size: number,
  required: boolean,
  defaultValue: string | null = null,
  array = false,
) {
  // Appwrite rejects defaultValue on required attributes
  const def = required ? undefined : (defaultValue ?? undefined);
  await safeRun(`attribute string: ${collectionId}.${key}`, () =>
    db.createStringAttribute(DATABASE_ID, collectionId, key, size, required, def, array),
  );
}

async function createBoolAttr(
  collectionId: string,
  key: string,
  required: boolean,
  defaultValue: boolean | null = null,
) {
  // Appwrite rejects defaultValue on required attributes
  const def = required ? undefined : (defaultValue ?? undefined);
  await safeRun(`attribute boolean: ${collectionId}.${key}`, () =>
    db.createBooleanAttribute(DATABASE_ID, collectionId, key, required, def),
  );
}

async function createIntAttr(
  collectionId: string,
  key: string,
  required: boolean,
  min?: number,
  max?: number,
  defaultValue?: number,
) {
  // Appwrite rejects defaultValue on required attributes
  const def = required ? undefined : defaultValue;
  await safeRun(`attribute integer: ${collectionId}.${key}`, () =>
    db.createIntegerAttribute(DATABASE_ID, collectionId, key, required, min, max, def),
  );
}

async function createFloatAttr(collectionId: string, key: string, required: boolean) {
  await safeRun(`attribute float: ${collectionId}.${key}`, () =>
    db.createFloatAttribute(DATABASE_ID, collectionId, key, required),
  );
}

async function createIndex(
  collectionId: string,
  key: string,
  type: IndexType,
  attributes: string[],
  orders: ('ASC' | 'DESC')[] = [],
) {
  await safeRun(`index: ${collectionId}.${key}`, () =>
    db.createIndex(DATABASE_ID, collectionId, key, type, attributes, orders),
  );
}

// ---------------------------------------------------------------------------
// Collection lifecycle helper
// ---------------------------------------------------------------------------

/**
 * In normal mode: creates collection, skips if already exists (409).
 * In --reset mode: deletes the collection first (ignores 404), then creates fresh.
 * WARNING: --reset destroys all existing data in the collection.
 */
async function ensureCollection(id: string, name: string) {
  if (RESET) {
    await safeRun(`delete collection: ${id}`, () => db.deleteCollection(DATABASE_ID, id));
  }
  await safeRun(`collection: ${id}`, () => db.createCollection(DATABASE_ID, id, name, []));
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

async function setupDatabase() {
  await safeRun(`database: ${DATABASE_ID}`, () => db.create(DATABASE_ID, 'AI Note Keeper'));
}

// ---------------------------------------------------------------------------
// notes collection
// ---------------------------------------------------------------------------

async function setupNotesCollection() {
  const C = 'notes';
  await ensureCollection(C, 'Notes');

  // userId kept at 36 (UUID/Appwrite $id length)
  await createStringAttr(C, 'userId', 36, true);
  // title: 300 chars is ample for note titles (~50 words)
  await createStringAttr(C, 'title', 300, false);
  // content: 100000 forces TEXT storage (> 65535) → excluded from VARCHAR row-size budget
  await createStringAttr(C, 'content', 100000, false);
  await createStringAttr(C, 'contentType', 20, false);
  await createStringAttr(C, 'color', 50, false);
  await createBoolAttr(C, 'active', true, true);
  await createBoolAttr(C, 'done', true, false);
  await createBoolAttr(C, 'isPinned', true, false);

  // Reminder fields — legacy
  await createIntAttr(C, 'triggerAt', false);
  // repeatRule: short enum string: 'none'|'daily'|'weekly'|'monthly'|'custom'
  await createStringAttr(C, 'repeatRule', 20, false);
  // repeatConfig: compact JSON object (e.g. {"interval":1,"weekdays":[1,3]})
  await createStringAttr(C, 'repeatConfig', 1000, false);

  // Reminder fields — new
  // repeat: compact JSON RepeatRule (e.g. {"kind":"weekly","interval":1,"weekdays":[1]})
  await createStringAttr(C, 'repeat', 1000, false);
  // baseAtLocal: ISO datetime string max ~25 chars ("2026-02-01T09:00")
  await createStringAttr(C, 'baseAtLocal', 30, false);
  await createIntAttr(C, 'startAt', false);
  await createIntAttr(C, 'nextTriggerAt', false);
  await createIntAttr(C, 'lastFiredAt', false);
  await createIntAttr(C, 'lastAcknowledgedAt', false);
  await createIntAttr(C, 'snoozedUntil', false);
  await createStringAttr(C, 'scheduleStatus', 30, false);
  await createStringAttr(C, 'timezone', 100, false);

  await createIntAttr(C, 'version', true, undefined, undefined, 0);
  await createIntAttr(C, 'deletedAt', false);
  await createIntAttr(C, 'updatedAt', true);
  await createIntAttr(C, 'createdAt', true);

  // Indexes
  await createIndex(C, 'by_userId', IndexType.Key, ['userId']);
  await createIndex(
    C,
    'by_userId_updatedAt',
    IndexType.Key,
    ['userId', 'updatedAt'],
    ['ASC', 'ASC'],
  );
  await createIndex(
    C,
    'by_userId_nextTriggerAt',
    IndexType.Key,
    ['userId', 'nextTriggerAt'],
    ['ASC', 'ASC'],
  );
  await createIndex(
    C,
    'by_userId_deletedAt',
    IndexType.Key,
    ['userId', 'deletedAt'],
    ['ASC', 'ASC'],
  );
}

// ---------------------------------------------------------------------------
// noteChangeEvents collection
// ---------------------------------------------------------------------------

async function setupNoteChangeEventsCollection() {
  const C = 'noteChangeEvents';
  await ensureCollection(C, 'Note Change Events');

  await createStringAttr(C, 'noteId', 36, true);
  await createStringAttr(C, 'userId', 36, true);
  await createStringAttr(C, 'operation', 20, true);
  await createIntAttr(C, 'changedAt', true);
  await createStringAttr(C, 'deviceId', 100, false);
  await createStringAttr(C, 'payloadHash', 64, false);

  await createIndex(
    C,
    'by_userId_changedAt',
    IndexType.Key,
    ['userId', 'changedAt'],
    ['ASC', 'ASC'],
  );
  await createIndex(C, 'by_noteId', IndexType.Key, ['noteId']);
}

// ---------------------------------------------------------------------------
// subscriptions collection
// ---------------------------------------------------------------------------

async function setupSubscriptionsCollection() {
  const C = 'subscriptions';
  await ensureCollection(C, 'Subscriptions');

  await createStringAttr(C, 'userId', 36, true);
  await createStringAttr(C, 'serviceName', 200, true);
  await createStringAttr(C, 'category', 100, false);
  await createFloatAttr(C, 'price', true);
  await createStringAttr(C, 'currency', 10, true);
  await createStringAttr(C, 'billingCycle', 20, true);
  await createIntAttr(C, 'billingCycleCustomDays', false);
  await createIntAttr(C, 'nextBillingDate', true);
  await createIntAttr(C, 'trialEndDate', false);
  await createStringAttr(C, 'status', 20, true);
  await createStringAttr(C, 'reminderDaysBefore', 200, false, '[]');
  await createIntAttr(C, 'nextReminderAt', false);
  await createIntAttr(C, 'lastNotifiedBillingDate', false);
  await createIntAttr(C, 'nextTrialReminderAt', false);
  await createIntAttr(C, 'lastNotifiedTrialEndDate', false);
  await createBoolAttr(C, 'active', true, true);
  await createIntAttr(C, 'deletedAt', false);
  await createIntAttr(C, 'createdAt', true);
  await createIntAttr(C, 'updatedAt', true);

  await createIndex(C, 'by_userId', IndexType.Key, ['userId']);
  await createIndex(
    C,
    'by_userId_nextReminderAt',
    IndexType.Key,
    ['userId', 'nextReminderAt'],
    ['ASC', 'ASC'],
  );
}

// ---------------------------------------------------------------------------
// devicePushTokens collection
// ---------------------------------------------------------------------------

async function setupDevicePushTokensCollection() {
  const C = 'devicePushTokens';
  await ensureCollection(C, 'Device Push Tokens');

  await createStringAttr(C, 'userId', 36, true);
  await createStringAttr(C, 'deviceId', 200, true);
  await createStringAttr(C, 'fcmToken', 500, true);
  await createStringAttr(C, 'platform', 20, true);
  await createIntAttr(C, 'updatedAt', true);

  await createIndex(C, 'by_userId_deviceId', IndexType.Unique, ['userId', 'deviceId']);
}

// ---------------------------------------------------------------------------
// cronState collection
// ($id === key so no separate key index needed)
// ---------------------------------------------------------------------------

async function setupCronStateCollection() {
  const C = 'cronState';
  await ensureCollection(C, 'Cron State');

  await createStringAttr(C, 'key', 100, true);
  await createIntAttr(C, 'lastCheckedAt', true);
}

// ---------------------------------------------------------------------------
// migrationAttempts collection
// ---------------------------------------------------------------------------

async function setupMigrationAttemptsCollection() {
  const C = 'migrationAttempts';
  await ensureCollection(C, 'Migration Attempts');

  await createStringAttr(C, 'key', 200, true);
  await createIntAttr(C, 'attempts', true, 0);
  await createIntAttr(C, 'lastAttemptAt', true);
  await createIntAttr(C, 'blockedUntil', false);

  await createIndex(C, 'by_key', IndexType.Unique, ['key']);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Setting up Appwrite schema for database "${DATABASE_ID}"…\n`);
  if (RESET) {
    console.log('⚠️  --reset mode: all collections will be deleted and recreated.\n');
  }

  await setupDatabase();

  console.log('\nnotes collection:');
  await setupNotesCollection();

  console.log('\nnoteChangeEvents collection:');
  await setupNoteChangeEventsCollection();

  console.log('\nsubscriptions collection:');
  await setupSubscriptionsCollection();

  console.log('\ndevicePushTokens collection:');
  await setupDevicePushTokensCollection();

  console.log('\ncronState collection:');
  await setupCronStateCollection();

  console.log('\nmigrationAttempts collection:');
  await setupMigrationAttemptsCollection();

  console.log('\n✅ Schema setup complete.');
}

main().catch((err) => {
  console.error('\nFatal error during schema setup:', err);
  process.exit(1);
});
