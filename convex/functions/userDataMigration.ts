/* eslint-disable @typescript-eslint/no-explicit-any */
import { mutation } from '../_generated/server';
import { v } from 'convex/values';
import { sha256 } from 'js-sha256';

import {
  WELCOME_NOTE_CONTENT,
  WELCOME_NOTE_TITLE,
} from '../../packages/shared/constants/welcomeNote';

const THROTTLE_THRESHOLD = 3;
const BASE_BLOCK_MS = 60 * 1000;
const MAX_BLOCK_MS = 15 * 60 * 1000;

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

type MigrationAttemptsRecord = {
  _id: string;
  key: string;
  attempts: number;
  lastAttemptAt: number;
  blockedUntil?: number;
};

type UserRecord = {
  _id: { toString(): string };
  username: string;
  passwordHash: string;
};

type NoteRecord = {
  _id: string;
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
  repeatConfig?: unknown;
  repeat?: unknown;
  snoozedUntil?: number;
  scheduleStatus?: string;
  timezone?: string;
  baseAtLocal?: string;
  startAt?: number;
  nextTriggerAt?: number;
  lastFiredAt?: number;
  lastAcknowledgedAt?: number;
  version?: number;
  deletedAt?: number;
  updatedAt: number;
  createdAt: number;
};

type SubscriptionRecord = {
  _id: string;
  userId: string;
  serviceName: string;
  category: string;
  price: number;
  currency: string;
  billingCycle: string;
  billingCycleCustomDays?: number;
  nextBillingDate: number;
  notes?: string;
  trialEndDate?: number;
  status: string;
  reminderDaysBefore: number[];
  nextReminderAt?: number;
  lastNotifiedBillingDate?: number;
  nextTrialReminderAt?: number;
  lastNotifiedTrialEndDate?: number;
  active: boolean;
  deletedAt?: number;
  createdAt: number;
  updatedAt: number;
};

type DeviceTokenRecord = {
  _id: string;
  id: string;
  userId: string;
  deviceId: string;
  fcmToken: string;
  platform: string;
  updatedAt: number;
};

type NoteChangeEventRecord = {
  _id: string;
  id: string;
  noteId: string;
  userId: string;
  operation: string;
  changedAt: number;
  deviceId: string;
  payloadHash: string;
};

type UserSnapshot = {
  notes: NoteRecord[];
  subscriptions: SubscriptionRecord[];
  tokens: DeviceTokenRecord[];
  events: NoteChangeEventRecord[];
};

const mergeStrategyValue = v.union(v.literal('cloud'), v.literal('local'), v.literal('both'));

const verifyPassword = (password: string, storedHash: string): boolean => {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  return sha256(salt + password) === hash;
};

const computeBlockMs = (attempts: number): number | null => {
  if (attempts < THROTTLE_THRESHOLD) return null;
  const power = attempts - THROTTLE_THRESHOLD;
  return Math.min(MAX_BLOCK_MS, BASE_BLOCK_MS * 2 ** power);
};

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

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
  if (snapshot.subscriptions.length > 0) {
    return false;
  }
  const activeNotes = snapshot.notes.filter((note) => note.active);
  if (activeNotes.length !== 1) {
    return false;
  }
  return isSampleWelcomeNote(activeNotes[0]);
};

const serializeNote = (note: NoteRecord): string =>
  stableStringify({
    id: note.id,
    title: note.title ?? null,
    content: note.content ?? null,
    contentType: note.contentType ?? null,
    color: note.color ?? null,
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
  const targetById = new Map(target.map((note) => [note.id, note]));
  return source.some((sourceNote) => {
    const targetNote = targetById.get(sourceNote.id);
    if (!targetNote) {
      return false;
    }
    return serializeNote(sourceNote) !== serializeNote(targetNote);
  });
};

const createSummary = (source: UserSnapshot, target: UserSnapshot): MergeSummary => ({
  sourceEmpty: isSnapshotEmpty(source),
  sourceSampleOnly: isSampleOnlySnapshot(source),
  targetEmpty: isSnapshotEmpty(target),
  hasConflicts: hasNoteConflicts(source.notes, target.notes),
  sourceCounts: buildCounts(source),
  targetCounts: buildCounts(target),
});

const cloneNoteForUser = (note: NoteRecord, userId: string, overrides?: Partial<NoteRecord>) => ({
  id: overrides?.id ?? note.id,
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
  updatedAt: overrides?.updatedAt ?? note.updatedAt,
  createdAt: overrides?.createdAt ?? note.createdAt,
});

const cloneSubscriptionForUser = (subscription: SubscriptionRecord, userId: string) => ({
  userId,
  serviceName: subscription.serviceName,
  category: subscription.category,
  price: subscription.price,
  currency: subscription.currency,
  billingCycle: subscription.billingCycle,
  billingCycleCustomDays: subscription.billingCycleCustomDays,
  nextBillingDate: subscription.nextBillingDate,
  notes: subscription.notes,
  trialEndDate: subscription.trialEndDate,
  status: subscription.status,
  reminderDaysBefore: subscription.reminderDaysBefore,
  nextReminderAt: subscription.nextReminderAt,
  lastNotifiedBillingDate: subscription.lastNotifiedBillingDate,
  nextTrialReminderAt: subscription.nextTrialReminderAt,
  lastNotifiedTrialEndDate: subscription.lastNotifiedTrialEndDate,
  active: subscription.active,
  deletedAt: subscription.deletedAt,
  createdAt: subscription.createdAt,
  updatedAt: subscription.updatedAt,
});

const cloneEventForUser = (event: NoteChangeEventRecord, userId: string, noteId?: string) => ({
  id: crypto.randomUUID(),
  noteId: noteId ?? event.noteId,
  userId,
  operation: event.operation,
  changedAt: event.changedAt,
  deviceId: event.deviceId,
  payloadHash: event.payloadHash,
});

const clearSnapshot = async (ctx: any, userId: string): Promise<void> => {
  const notes = await ctx.db
    .query('notes')
    .filter((q: any) => q.eq(q.field('userId'), userId))
    .collect();
  for (const note of notes) {
    await ctx.db.delete(note._id);
  }

  const subscriptions = await ctx.db
    .query('subscriptions')
    .filter((q: any) => q.eq(q.field('userId'), userId))
    .collect();
  for (const subscription of subscriptions) {
    await ctx.db.delete(subscription._id);
  }

  const events = await ctx.db
    .query('noteChangeEvents')
    .filter((q: any) => q.eq(q.field('userId'), userId))
    .collect();
  for (const event of events) {
    await ctx.db.delete(event._id);
  }
};

const writeLocalStrategy = async (ctx: any, source: UserSnapshot, targetUserId: string) => {
  await clearSnapshot(ctx, targetUserId);

  for (const note of source.notes) {
    await ctx.db.insert('notes', cloneNoteForUser(note, targetUserId));
  }

  for (const subscription of source.subscriptions) {
    await ctx.db.insert('subscriptions', cloneSubscriptionForUser(subscription, targetUserId));
  }

  for (const event of source.events) {
    await ctx.db.insert('noteChangeEvents', cloneEventForUser(event, targetUserId));
  }
};

const writeBothStrategy = async (
  ctx: any,
  source: UserSnapshot,
  target: UserSnapshot,
  targetUserId: string,
) => {
  const targetNotesById = new Map(target.notes.map((note) => [note.id, note]));

  for (const note of source.notes) {
    const existing = targetNotesById.get(note.id);
    if (!existing) {
      await ctx.db.insert('notes', cloneNoteForUser(note, targetUserId));
      continue;
    }

    if (serializeNote(note) === serializeNote(existing)) {
      continue;
    }

    const title = note.title ? `${note.title} (Local copy)` : 'Local copy';
    await ctx.db.insert(
      'notes',
      cloneNoteForUser(note, targetUserId, {
        id: crypto.randomUUID(),
        title,
      }),
    );
  }

  for (const subscription of source.subscriptions) {
    await ctx.db.insert('subscriptions', cloneSubscriptionForUser(subscription, targetUserId));
  }

  const existingTargetNoteIds = new Set(target.notes.map((note) => note.id));
  for (const event of source.events) {
    if (!existingTargetNoteIds.has(event.noteId)) {
      continue;
    }
    await ctx.db.insert('noteChangeEvents', cloneEventForUser(event, targetUserId));
  }
};

const collectSnapshot = async (ctx: any, userId: string): Promise<UserSnapshot> => {
  const [notes, subscriptions, tokens, events] = await Promise.all([
    ctx.db
      .query('notes')
      .filter((q: any) => q.eq(q.field('userId'), userId))
      .collect(),
    ctx.db
      .query('subscriptions')
      .filter((q: any) => q.eq(q.field('userId'), userId))
      .collect(),
    ctx.db
      .query('devicePushTokens')
      .filter((q: any) => q.eq(q.field('userId'), userId))
      .collect(),
    ctx.db
      .query('noteChangeEvents')
      .filter((q: any) => q.eq(q.field('userId'), userId))
      .collect(),
  ]);

  return { notes, subscriptions, tokens, events };
};

const createAttemptHelpers = async (ctx: any, attemptKey: string, now: number) => {
  const existingAttempt = (await ctx.db
    .query('migrationAttempts')
    .withIndex('by_key', (q: any) => q.eq('key', attemptKey))
    .first()) as MigrationAttemptsRecord | null;

  if (existingAttempt?.blockedUntil && existingAttempt.blockedUntil > now) {
    throw new Error('Too many failed migration attempts. Try again later.');
  }

  const markFailedAttempt = async (): Promise<void> => {
    const attempts = (existingAttempt?.attempts ?? 0) + 1;
    const blockMs = computeBlockMs(attempts);
    const blockedUntil = blockMs ? now + blockMs : undefined;

    if (existingAttempt) {
      await ctx.db.patch(existingAttempt._id, {
        attempts,
        lastAttemptAt: now,
        blockedUntil,
      });
      return;
    }

    await ctx.db.insert('migrationAttempts', {
      key: attemptKey,
      attempts,
      lastAttemptAt: now,
      blockedUntil,
    });
  };

  const clearFailedAttempts = async (): Promise<void> => {
    if (!existingAttempt) return;
    await ctx.db.patch(existingAttempt._id, {
      attempts: 0,
      lastAttemptAt: now,
      blockedUntil: undefined,
    });
  };

  return { markFailedAttempt, clearFailedAttempts };
};

const getUserById = async (ctx: any, userId: string): Promise<UserRecord | null> => {
  let record: unknown = null;
  try {
    record = await ctx.db.get(userId as any);
  } catch {
    record = null;
  }
  if (!record || typeof record !== 'object') {
    return null;
  }
  const maybeUser = record as Partial<UserRecord>;
  if (typeof maybeUser.username !== 'string' || typeof maybeUser.passwordHash !== 'string') {
    return null;
  }
  return maybeUser as UserRecord;
};

const validateAccountUser = async (
  ctx: any,
  args: { accountUserId: string; username?: string; password?: string },
  markFailedAttempt: () => Promise<void>,
): Promise<UserRecord> => {
  const targetUser = await getUserById(ctx, args.accountUserId);
  if (!targetUser) {
    await markFailedAttempt();
    throw new Error('Migration target must be a valid account user');
  }

  if (!args.username || !args.password) {
    await markFailedAttempt();
    throw new Error('Credentials required to migrate data into this account');
  }

  const userByUsername = (await ctx.db
    .query('users')
    .withIndex('by_username', (q: any) => q.eq('username', args.username))
    .first()) as UserRecord | null;

  if (!userByUsername || userByUsername._id.toString() !== args.accountUserId) {
    await markFailedAttempt();
    throw new Error('Invalid migration target account');
  }

  if (!verifyPassword(args.password, userByUsername.passwordHash)) {
    await markFailedAttempt();
    throw new Error('Invalid credentials');
  }

  return userByUsername;
};

const runPreflight = async (
  ctx: any,
  args: { fromUserId: string; toUserId: string; username?: string; password?: string },
): Promise<MergeSummary> => {
  const now = Date.now();
  const attemptKey = args.toUserId;
  const { markFailedAttempt, clearFailedAttempts } = await createAttemptHelpers(
    ctx,
    attemptKey,
    now,
  );

  await validateAccountUser(
    ctx,
    { accountUserId: args.toUserId, username: args.username, password: args.password },
    markFailedAttempt,
  );

  if (args.fromUserId === args.toUserId) {
    await clearFailedAttempts();
    const emptySnapshot: UserSnapshot = { notes: [], subscriptions: [], tokens: [], events: [] };
    return createSummary(emptySnapshot, emptySnapshot);
  }

  const [sourceSnapshot, targetSnapshot] = await Promise.all([
    collectSnapshot(ctx, args.fromUserId),
    collectSnapshot(ctx, args.toUserId),
  ]);

  await clearFailedAttempts();
  return createSummary(sourceSnapshot, targetSnapshot);
};

const runApply = async (
  ctx: any,
  args: {
    fromUserId: string;
    toUserId: string;
    username?: string;
    password?: string;
    strategy: MergeStrategy;
  },
) => {
  const targetAccount = await getUserById(ctx, args.toUserId);
  const sourceAccount = await getUserById(ctx, args.fromUserId);
  const accountUserId = targetAccount?._id.toString() ?? sourceAccount?._id.toString();
  if (!accountUserId) {
    throw new Error('Either source or target must be a valid account user');
  }

  const now = Date.now();
  const attemptKey = accountUserId;
  const { markFailedAttempt, clearFailedAttempts } = await createAttemptHelpers(
    ctx,
    attemptKey,
    now,
  );

  await validateAccountUser(
    ctx,
    { accountUserId, username: args.username, password: args.password },
    markFailedAttempt,
  );

  const [sourceSnapshot, targetSnapshot] = await Promise.all([
    collectSnapshot(ctx, args.fromUserId),
    collectSnapshot(ctx, args.toUserId),
  ]);
  const summary = createSummary(sourceSnapshot, targetSnapshot);

  if (args.fromUserId !== args.toUserId) {
    if (args.strategy === 'local') {
      await writeLocalStrategy(ctx, sourceSnapshot, args.toUserId);
    } else if (args.strategy === 'both') {
      await writeBothStrategy(ctx, sourceSnapshot, targetSnapshot, args.toUserId);
    }
  }

  await clearFailedAttempts();

  const targetAfter = await collectSnapshot(ctx, args.toUserId);
  return {
    strategy: args.strategy,
    summary,
    targetCounts: buildCounts(targetAfter),
  };
};

export const preflightUserDataMerge = mutation({
  args: {
    fromUserId: v.string(),
    toUserId: v.string(),
    username: v.optional(v.string()),
    password: v.optional(v.string()),
  },
  handler: async (ctx, args) => runPreflight(ctx, args),
});

export const applyUserDataMerge = mutation({
  args: {
    fromUserId: v.string(),
    toUserId: v.string(),
    username: v.optional(v.string()),
    password: v.optional(v.string()),
    strategy: mergeStrategyValue,
  },
  handler: async (ctx, args) => runApply(ctx, args),
});
