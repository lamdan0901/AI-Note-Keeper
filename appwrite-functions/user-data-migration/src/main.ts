import { Client, Databases, ID, Permission, Query, Role, Users } from 'node-appwrite';

// ---------------------------------------------------------------------------
// Appwrite function context types
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
// Constants
// ---------------------------------------------------------------------------

const DATABASE_ID = 'ai-note-keeper';
const NOTES_COLLECTION = 'notes';
const SUBSCRIPTIONS_COLLECTION = 'subscriptions';
const NOTE_CHANGE_EVENTS_COLLECTION = 'noteChangeEvents';
const DEVICE_PUSH_TOKENS_COLLECTION = 'devicePushTokens';
const MIGRATION_ATTEMPTS_COLLECTION = 'migrationAttempts';
const PAGE_LIMIT = 100;

const THROTTLE_THRESHOLD = 3;
const BASE_BLOCK_MS = 60 * 1000;
const MAX_BLOCK_MS = 15 * 60 * 1000;

const WELCOME_NOTE_TITLE = 'Welcome to AI Note Keeper';
const WELCOME_NOTE_CONTENT = 'This is your first note. Edit or delete it anytime.';

function userDocumentPermissions(userId: string): string[] {
  return [Permission.read(Role.user(userId)), Permission.write(Role.user(userId))];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MergeStrategy = 'cloud' | 'local' | 'both';

type MergeCounts = {
  notes: number;
  subscriptions: number;
  tokens: number;
  events: number;
};

type MergeSummary = {
  sourceEmpty: boolean;
  sourceSampleOnly: boolean;
  targetEmpty: boolean;
  hasConflicts: boolean;
  sourceCounts: MergeCounts;
  targetCounts: MergeCounts;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NoteRecord = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SubscriptionRecord = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DeviceTokenRecord = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NoteChangeEventRecord = Record<string, any>;

type UserSnapshot = {
  notes: NoteRecord[];
  subscriptions: SubscriptionRecord[];
  tokens: DeviceTokenRecord[];
  events: NoteChangeEventRecord[];
};

// ---------------------------------------------------------------------------
// Throttle logic
// ---------------------------------------------------------------------------

const computeBlockMs = (attempts: number): number | null => {
  if (attempts < THROTTLE_THRESHOLD) return null;
  const power = attempts - THROTTLE_THRESHOLD;
  return Math.min(MAX_BLOCK_MS, BASE_BLOCK_MS * 2 ** power);
};

async function createAttemptHelpers(
  databases: Databases,
  attemptKey: string,
  now: number,
): Promise<{
  markFailedAttempt: () => Promise<void>;
  clearFailedAttempts: () => Promise<void>;
}> {
  const result = await databases.listDocuments(DATABASE_ID, MIGRATION_ATTEMPTS_COLLECTION, [
    Query.equal('key', attemptKey),
    Query.limit(1),
  ]);
  const existingDoc = result.documents[0] as unknown as
    | {
        $id: string;
        attempts: number;
        lastAttemptAt: number;
        blockedUntil?: number;
      }
    | undefined;

  if (existingDoc?.blockedUntil && existingDoc.blockedUntil > now) {
    throw Object.assign(new Error('Too many failed migration attempts. Try again later.'), {
      blocked: true,
    });
  }

  const markFailedAttempt = async (): Promise<void> => {
    const attempts = (existingDoc?.attempts ?? 0) + 1;
    const blockMs = computeBlockMs(attempts);
    const blockedUntil = blockMs ? now + blockMs : null;

    if (existingDoc) {
      await databases.updateDocument(DATABASE_ID, MIGRATION_ATTEMPTS_COLLECTION, existingDoc.$id, {
        attempts,
        lastAttemptAt: now,
        blockedUntil,
      });
    } else {
      await databases.createDocument(DATABASE_ID, MIGRATION_ATTEMPTS_COLLECTION, ID.unique(), {
        key: attemptKey,
        attempts,
        lastAttemptAt: now,
        blockedUntil,
      });
    }
  };

  const clearFailedAttempts = async (): Promise<void> => {
    if (!existingDoc) return;
    await databases.updateDocument(DATABASE_ID, MIGRATION_ATTEMPTS_COLLECTION, existingDoc.$id, {
      attempts: 0,
      lastAttemptAt: now,
      blockedUntil: null,
    });
  };

  return { markFailedAttempt, clearFailedAttempts };
}

// ---------------------------------------------------------------------------
// Credential verification — Appwrite-native (no SHA256)
// ---------------------------------------------------------------------------

async function verifyAccountCredentials(
  endpoint: string,
  projectId: string,
  users: Users,
  username: string,
  password: string,
  expectedUserId: string,
  markFailedAttempt: () => Promise<void>,
): Promise<void> {
  const syntheticEmail = `${username}@app.notekeeper.local`;

  let sessionId: string;
  let verifiedUserId: string;

  try {
    const sessionRes = await fetch(`${endpoint}/v1/account/sessions/email`, {
      method: 'POST',
      headers: {
        'X-Appwrite-Project': projectId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: syntheticEmail, password }),
    });

    if (!sessionRes.ok) {
      await markFailedAttempt();
      throw new Error('Invalid credentials');
    }

    const sessionData = (await sessionRes.json()) as { $id: string; userId: string };
    sessionId = sessionData.$id;
    verifiedUserId = sessionData.userId;
  } catch (err) {
    if ((err as Error).message === 'Invalid credentials') throw err;
    await markFailedAttempt();
    throw new Error('Invalid credentials');
  }

  // Clean up the temporary session immediately
  try {
    await users.deleteSession(verifiedUserId, sessionId);
  } catch {
    // Non-critical: session will expire on its own
  }

  if (verifiedUserId !== expectedUserId) {
    await markFailedAttempt();
    throw new Error('Invalid migration target account');
  }
}

// ---------------------------------------------------------------------------
// Snapshot helpers — paginated Appwrite SDK calls
// ---------------------------------------------------------------------------

async function listAllDocuments(
  databases: Databases,
  collection: string,
  userId: string,
): Promise<NoteRecord[]> {
  const docs: NoteRecord[] = [];
  let cursor: string | undefined;

  while (true) {
    const queries = [Query.equal('userId', userId), Query.limit(PAGE_LIMIT)];
    if (cursor) queries.push(Query.cursorAfter(cursor));

    const result = await databases.listDocuments(DATABASE_ID, collection, queries);
    docs.push(...result.documents);

    if (result.documents.length < PAGE_LIMIT) break;
    cursor = result.documents[result.documents.length - 1].$id as string;
  }

  return docs;
}

async function collectSnapshot(databases: Databases, userId: string): Promise<UserSnapshot> {
  const [notes, subscriptions, tokens, events] = await Promise.all([
    listAllDocuments(databases, NOTES_COLLECTION, userId),
    listAllDocuments(databases, SUBSCRIPTIONS_COLLECTION, userId),
    listAllDocuments(databases, DEVICE_PUSH_TOKENS_COLLECTION, userId),
    listAllDocuments(databases, NOTE_CHANGE_EVENTS_COLLECTION, userId),
  ]);
  return { notes, subscriptions, tokens, events };
}

async function clearSnapshot(databases: Databases, userId: string): Promise<void> {
  for (const collection of [
    NOTES_COLLECTION,
    SUBSCRIPTIONS_COLLECTION,
    NOTE_CHANGE_EVENTS_COLLECTION,
  ]) {
    const docs = await listAllDocuments(databases, collection, userId);
    await Promise.all(
      docs.map((doc) => databases.deleteDocument(DATABASE_ID, collection, doc.$id as string)),
    );
  }
}

// ---------------------------------------------------------------------------
// Note serialization for conflict detection
// ---------------------------------------------------------------------------

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${(value as unknown[]).map((e) => stableStringify(e)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const serializeNote = (note: NoteRecord): string =>
  stableStringify({
    id: note.id ?? note.$id,
    title: note.title ?? null,
    content: note.content ?? null,
    active: note.active,
    done: note.done ?? false,
    isPinned: note.isPinned ?? false,
    triggerAt: note.triggerAt ?? null,
    repeatRule: note.repeatRule ?? null,
    repeatConfig: note.repeatConfig ?? null,
    repeat: note.repeat ?? null,
    snoozedUntil: note.snoozedUntil ?? null,
    scheduleStatus: note.scheduleStatus ?? null,
    timezone: note.timezone ?? null,
    baseAtLocal: note.baseAtLocal ?? null,
    startAt: note.startAt ?? null,
    nextTriggerAt: note.nextTriggerAt ?? null,
    lastFiredAt: note.lastFiredAt ?? null,
    lastAcknowledgedAt: note.lastAcknowledgedAt ?? null,
    deletedAt: note.deletedAt ?? null,
  });

const hasNoteConflicts = (source: NoteRecord[], target: NoteRecord[]): boolean => {
  const noteId = (n: NoteRecord) => (n.id ?? n.$id) as string;
  const targetById = new Map(target.map((n) => [noteId(n), n]));
  return source.some((sn) => {
    const tn = targetById.get(noteId(sn));
    if (!tn) return false;
    return serializeNote(sn) !== serializeNote(tn);
  });
};

// ---------------------------------------------------------------------------
// Summary builders
// ---------------------------------------------------------------------------

const isSampleWelcomeNote = (note: NoteRecord): boolean =>
  note.active === true &&
  (note.title ?? null) === WELCOME_NOTE_TITLE &&
  (note.content ?? null) === WELCOME_NOTE_CONTENT;

const buildCounts = (snapshot: UserSnapshot): MergeCounts => ({
  notes: snapshot.notes.length,
  subscriptions: snapshot.subscriptions.length,
  tokens: snapshot.tokens.length,
  events: snapshot.events.length,
});

const isSnapshotEmpty = (snapshot: UserSnapshot): boolean =>
  snapshot.notes.length === 0 &&
  snapshot.subscriptions.length === 0 &&
  snapshot.tokens.length === 0 &&
  snapshot.events.length === 0;

const isSampleOnlySnapshot = (snapshot: UserSnapshot): boolean => {
  if (snapshot.subscriptions.length > 0) return false;
  const activeNotes = snapshot.notes.filter((n) => n.active);
  if (activeNotes.length !== 1) return false;
  return isSampleWelcomeNote(activeNotes[0]);
};

const createSummary = (source: UserSnapshot, target: UserSnapshot): MergeSummary => ({
  sourceEmpty: isSnapshotEmpty(source),
  sourceSampleOnly: isSampleOnlySnapshot(source),
  targetEmpty: isSnapshotEmpty(target),
  hasConflicts: hasNoteConflicts(source.notes, target.notes),
  sourceCounts: buildCounts(source),
  targetCounts: buildCounts(target),
});

// ---------------------------------------------------------------------------
// Clone helpers
// ---------------------------------------------------------------------------

function cloneNoteForUser(
  note: NoteRecord,
  userId: string,
  overrides?: { id?: string; title?: string },
): Record<string, unknown> {
  return {
    id: overrides?.id ?? note.id ?? note.$id,
    userId,
    title: overrides?.title ?? note.title,
    content: note.content,
    contentType: note.contentType,
    color: note.color,
    active: note.active,
    done: note.done,
    isPinned: note.isPinned,
    triggerAt: note.triggerAt,
    repeatRule: note.repeatRule,
    repeatConfig: note.repeatConfig,
    repeat: note.repeat,
    snoozedUntil: note.snoozedUntil,
    scheduleStatus: note.scheduleStatus,
    timezone: note.timezone,
    baseAtLocal: note.baseAtLocal,
    startAt: note.startAt,
    nextTriggerAt: note.nextTriggerAt,
    lastFiredAt: note.lastFiredAt,
    lastAcknowledgedAt: note.lastAcknowledgedAt,
    version: note.version,
    deletedAt: note.deletedAt,
    updatedAt: note.updatedAt,
    createdAt: note.createdAt,
  };
}

function cloneSubscriptionForUser(
  sub: SubscriptionRecord,
  userId: string,
): Record<string, unknown> {
  return {
    userId,
    serviceName: sub.serviceName,
    category: sub.category,
    price: sub.price,
    currency: sub.currency,
    billingCycle: sub.billingCycle,
    billingCycleCustomDays: sub.billingCycleCustomDays,
    nextBillingDate: sub.nextBillingDate,
    notes: sub.notes,
    trialEndDate: sub.trialEndDate,
    status: sub.status,
    reminderDaysBefore: sub.reminderDaysBefore,
    nextReminderAt: sub.nextReminderAt,
    lastNotifiedBillingDate: sub.lastNotifiedBillingDate,
    nextTrialReminderAt: sub.nextTrialReminderAt,
    lastNotifiedTrialEndDate: sub.lastNotifiedTrialEndDate,
    active: sub.active,
    deletedAt: sub.deletedAt,
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt,
  };
}

function cloneEventForUser(
  event: NoteChangeEventRecord,
  userId: string,
  noteId?: string,
): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    noteId: noteId ?? event.noteId,
    userId,
    operation: event.operation,
    changedAt: event.changedAt,
    deviceId: event.deviceId,
    payloadHash: event.payloadHash,
  };
}

// ---------------------------------------------------------------------------
// Strategy writers
// ---------------------------------------------------------------------------

async function writeLocalStrategy(
  databases: Databases,
  source: UserSnapshot,
  targetUserId: string,
): Promise<void> {
  await clearSnapshot(databases, targetUserId);

  for (const note of source.notes) {
    await databases.createDocument(
      DATABASE_ID,
      NOTES_COLLECTION,
      (note.id ?? note.$id) as string,
      cloneNoteForUser(note, targetUserId),
      userDocumentPermissions(targetUserId),
    );
  }

  for (const sub of source.subscriptions) {
    await databases.createDocument(
      DATABASE_ID,
      SUBSCRIPTIONS_COLLECTION,
      ID.unique(),
      cloneSubscriptionForUser(sub, targetUserId),
      userDocumentPermissions(targetUserId),
    );
  }

  for (const event of source.events) {
    await databases.createDocument(
      DATABASE_ID,
      NOTE_CHANGE_EVENTS_COLLECTION,
      ID.unique(),
      cloneEventForUser(event, targetUserId),
      userDocumentPermissions(targetUserId),
    );
  }
}

async function writeBothStrategy(
  databases: Databases,
  source: UserSnapshot,
  target: UserSnapshot,
  targetUserId: string,
): Promise<void> {
  const noteId = (n: NoteRecord) => (n.id ?? n.$id) as string;
  const targetNotesById = new Map(target.notes.map((n) => [noteId(n), n]));

  for (const note of source.notes) {
    const existing = targetNotesById.get(noteId(note));
    if (!existing) {
      await databases.createDocument(
        DATABASE_ID,
        NOTES_COLLECTION,
        noteId(note),
        cloneNoteForUser(note, targetUserId),
        userDocumentPermissions(targetUserId),
      );
      continue;
    }
    if (serializeNote(note) === serializeNote(existing)) continue;

    const title = note.title ? `${note.title as string} (Local copy)` : 'Local copy';
    await databases.createDocument(
      DATABASE_ID,
      NOTES_COLLECTION,
      ID.unique(),
      cloneNoteForUser(note, targetUserId, { id: crypto.randomUUID(), title }),
      userDocumentPermissions(targetUserId),
    );
  }

  for (const sub of source.subscriptions) {
    await databases.createDocument(
      DATABASE_ID,
      SUBSCRIPTIONS_COLLECTION,
      ID.unique(),
      cloneSubscriptionForUser(sub, targetUserId),
      userDocumentPermissions(targetUserId),
    );
  }

  const existingTargetNoteIds = new Set(target.notes.map((n) => noteId(n)));
  for (const event of source.events) {
    if (!existingTargetNoteIds.has(event.noteId as string)) continue;
    await databases.createDocument(
      DATABASE_ID,
      NOTE_CHANGE_EVENTS_COLLECTION,
      ID.unique(),
      cloneEventForUser(event, targetUserId),
      userDocumentPermissions(targetUserId),
    );
  }
}

// ---------------------------------------------------------------------------
// Business logic
// ---------------------------------------------------------------------------

async function runPreflight(
  databases: Databases,
  users: Users,
  endpoint: string,
  projectId: string,
  args: { fromUserId: string; toUserId: string; username: string; password: string },
): Promise<MergeSummary> {
  const now = Date.now();
  const { markFailedAttempt, clearFailedAttempts } = await createAttemptHelpers(
    databases,
    args.toUserId,
    now,
  );

  await verifyAccountCredentials(
    endpoint,
    projectId,
    users,
    args.username,
    args.password,
    args.toUserId,
    markFailedAttempt,
  );

  if (args.fromUserId === args.toUserId) {
    await clearFailedAttempts();
    const empty: UserSnapshot = { notes: [], subscriptions: [], tokens: [], events: [] };
    return createSummary(empty, empty);
  }

  const [source, target] = await Promise.all([
    collectSnapshot(databases, args.fromUserId),
    collectSnapshot(databases, args.toUserId),
  ]);

  await clearFailedAttempts();
  return createSummary(source, target);
}

async function runApply(
  databases: Databases,
  users: Users,
  endpoint: string,
  projectId: string,
  args: {
    fromUserId: string;
    toUserId: string;
    username: string;
    password: string;
    strategy: MergeStrategy;
  },
): Promise<{ strategy: MergeStrategy; summary: MergeSummary; targetCounts: MergeCounts }> {
  const now = Date.now();
  // The throttle key is the named account (toUserId is always the destination account)
  const attemptKey = args.toUserId;
  const { markFailedAttempt, clearFailedAttempts } = await createAttemptHelpers(
    databases,
    attemptKey,
    now,
  );

  await verifyAccountCredentials(
    endpoint,
    projectId,
    users,
    args.username,
    args.password,
    args.toUserId,
    markFailedAttempt,
  );

  const [source, target] = await Promise.all([
    collectSnapshot(databases, args.fromUserId),
    collectSnapshot(databases, args.toUserId),
  ]);

  const summary = createSummary(source, target);

  if (args.fromUserId !== args.toUserId) {
    if (args.strategy === 'local') {
      await writeLocalStrategy(databases, source, args.toUserId);
    } else if (args.strategy === 'both') {
      await writeBothStrategy(databases, source, target, args.toUserId);
    }
    // strategy === 'cloud': no data movement needed
  }

  await clearFailedAttempts();
  const targetAfter = await collectSnapshot(databases, args.toUserId);
  return { strategy: args.strategy, summary, targetCounts: buildCounts(targetAfter) };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export default async function main(context: AppwriteContext): Promise<void> {
  const { req, res, error } = context;

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
  const users = new Users(client);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(req.body || '{}') as Record<string, unknown>;
  } catch {
    return res.json({ error: 'Invalid JSON body' }, 400);
  }

  const path = req.path.replace(/\/$/, '');

  try {
    if (req.method === 'POST' && path === '/preflight') {
      const { fromUserId, toUserId, username, password } = body as {
        fromUserId?: string;
        toUserId?: string;
        username?: string;
        password?: string;
      };
      if (!fromUserId || !toUserId || !username || !password) {
        return res.json(
          { error: 'Missing required fields: fromUserId, toUserId, username, password' },
          400,
        );
      }
      const summary = await runPreflight(databases, users, endpoint, projectId, {
        fromUserId,
        toUserId,
        username,
        password,
      });
      return res.json(summary);
    }

    if (req.method === 'POST' && path === '/apply') {
      const { fromUserId, toUserId, username, password, strategy } = body as {
        fromUserId?: string;
        toUserId?: string;
        username?: string;
        password?: string;
        strategy?: MergeStrategy;
      };
      if (!fromUserId || !toUserId || !username || !password || !strategy) {
        return res.json(
          { error: 'Missing required fields: fromUserId, toUserId, username, password, strategy' },
          400,
        );
      }
      if (!['cloud', 'local', 'both'].includes(strategy)) {
        return res.json({ error: 'Invalid strategy. Must be cloud, local, or both.' }, 400);
      }
      const result = await runApply(databases, users, endpoint, projectId, {
        fromUserId,
        toUserId,
        username,
        password,
        strategy,
      });
      return res.json(result);
    }

    return res.json({ error: 'Not found' }, 404);
  } catch (err) {
    const message = (err as Error).message ?? 'Unknown error';
    const isBlocked = (err as { blocked?: boolean }).blocked === true;

    if (isBlocked) {
      return res.json({ error: message }, 429);
    }
    if (
      message.includes('Invalid credentials') ||
      message.includes('Invalid migration target account') ||
      message.includes('Migration target must be a valid account user')
    ) {
      return res.json({ error: message }, 401);
    }

    error(`[user-data-migration] Error: ${message}`);
    return res.json({ error: 'Internal server error' }, 500);
  }
}
