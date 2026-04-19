import { createRequire } from 'node:module';

import { verifyPassword } from '../auth/passwords.js';
import { AppError } from '../middleware/error-middleware.js';
import type {
  MergeApplyInput,
  MergeApplyResult,
  MergeCounts,
  MergePreflightInput,
  MergePreflightResult,
  MergeResolution,
  MergeSummary,
} from './contracts.js';
import {
  createMergeRepository,
  type MergeNoteRecord,
  type MergeRepository,
  type MergeRepositoryTransaction,
  type MergeSnapshot,
} from './repositories/merge-repository.js';

const require = createRequire(import.meta.url);

const loadSharedResolveMergeResolution = (): ((summary: MergeSummary) => MergeResolution) | null => {
  try {
    const shared = require('../../../../packages/shared/auth/userDataMerge.js') as {
      resolveMergeResolution?: (summary: MergeSummary) => MergeResolution;
    };

    return shared.resolveMergeResolution ?? null;
  } catch {
    return null;
  }
};

const loadSharedWelcomeConstants = (): Readonly<{
  WELCOME_NOTE_TITLE: string;
  WELCOME_NOTE_CONTENT: string;
}> | null => {
  try {
    const shared = require('../../../../packages/shared/constants/welcomeNote.js') as {
      WELCOME_NOTE_TITLE?: string;
      WELCOME_NOTE_CONTENT?: string;
    };

    if (!shared.WELCOME_NOTE_TITLE || !shared.WELCOME_NOTE_CONTENT) {
      return null;
    }

    return {
      WELCOME_NOTE_TITLE: shared.WELCOME_NOTE_TITLE,
      WELCOME_NOTE_CONTENT: shared.WELCOME_NOTE_CONTENT,
    };
  } catch {
    return null;
  }
};

const sharedResolveMergeResolution = loadSharedResolveMergeResolution();
const sharedWelcomeConstants = loadSharedWelcomeConstants();

const WELCOME_NOTE_TITLE = sharedWelcomeConstants?.WELCOME_NOTE_TITLE ?? 'Welcome to AI Note Keeper';
const WELCOME_NOTE_CONTENT =
  sharedWelcomeConstants?.WELCOME_NOTE_CONTENT ??
  'This is your first note. Edit or delete it anytime.';

const resolveMergeResolution = (summary: MergeSummary): MergeResolution => {
  if (sharedResolveMergeResolution) {
    return sharedResolveMergeResolution(summary);
  }

  if (summary.sourceEmpty || summary.sourceSampleOnly) {
    return 'cloud';
  }

  if (summary.targetEmpty) {
    return 'local';
  }

  return 'prompt';
};

const THROTTLE_THRESHOLD = 3;
const BASE_BLOCK_MS = 60 * 1000;
const MAX_BLOCK_MS = 15 * 60 * 1000;

type VerifyPasswordFn = (
  password: string,
  storedHash: string,
) => Promise<Readonly<{ verified: boolean }>>;

type MergeServiceDeps = Readonly<{
  repository?: MergeRepository;
  now?: () => Date;
  verifyPasswordFn?: VerifyPasswordFn;
}>;

export type MergeService = Readonly<{
  preflight: (input: MergePreflightInput) => Promise<MergePreflightResult>;
  apply: (input: MergeApplyInput) => Promise<MergeApplyResult>;
}>;

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );

    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
};

const serializeNote = (note: MergeNoteRecord): string => {
  return stableStringify({
    id: note.id,
    title: note.title,
    content: note.content,
    contentType: note.contentType,
    color: note.color,
    active: note.active,
    done: note.done,
    isPinned: note.isPinned,
    triggerAt: note.triggerAt?.getTime() ?? null,
    repeatRule: note.repeatRule,
    repeatConfig: note.repeatConfig,
    repeat: note.repeat,
    snoozedUntil: note.snoozedUntil?.getTime() ?? null,
    scheduleStatus: note.scheduleStatus,
    timezone: note.timezone,
    baseAtLocal: note.baseAtLocal,
    startAt: note.startAt?.getTime() ?? null,
    nextTriggerAt: note.nextTriggerAt?.getTime() ?? null,
    lastFiredAt: note.lastFiredAt?.getTime() ?? null,
    lastAcknowledgedAt: note.lastAcknowledgedAt?.getTime() ?? null,
    version: note.version,
    deletedAt: note.deletedAt?.getTime() ?? null,
  });
};

const buildCounts = (snapshot: MergeSnapshot): MergeCounts => {
  return {
    notes: snapshot.notes.length,
    subscriptions: snapshot.subscriptions.length,
    tokens: snapshot.tokens.length,
    events: snapshot.events.length,
  };
};

const isSampleWelcomeNote = (note: MergeNoteRecord): boolean => {
  return (
    note.active === true &&
    (note.title ?? null) === WELCOME_NOTE_TITLE &&
    (note.content ?? null) === WELCOME_NOTE_CONTENT
  );
};

const isSnapshotEmpty = (snapshot: MergeSnapshot): boolean => {
  return (
    snapshot.notes.length === 0 &&
    snapshot.subscriptions.length === 0 &&
    snapshot.tokens.length === 0 &&
    snapshot.events.length === 0
  );
};

const isSampleOnlySnapshot = (snapshot: MergeSnapshot): boolean => {
  if (snapshot.subscriptions.length > 0 || snapshot.tokens.length > 0 || snapshot.events.length > 0) {
    return false;
  }

  const activeNotes = snapshot.notes.filter((note) => note.active);
  if (activeNotes.length !== 1) {
    return false;
  }

  return isSampleWelcomeNote(activeNotes[0]);
};

const getConflictingNoteIds = (source: MergeSnapshot, target: MergeSnapshot): ReadonlySet<string> => {
  const targetById = new Map(target.notes.map((note) => [note.id, note]));
  const conflicts = new Set<string>();

  for (const sourceNote of source.notes) {
    const targetNote = targetById.get(sourceNote.id);
    if (!targetNote) {
      continue;
    }

    if (serializeNote(sourceNote) !== serializeNote(targetNote)) {
      conflicts.add(sourceNote.id);
    }
  }

  return conflicts;
};

const toSummary = (source: MergeSnapshot, target: MergeSnapshot): MergeSummary => {
  const conflictingNoteIds = getConflictingNoteIds(source, target);

  return {
    sourceEmpty: isSnapshotEmpty(source),
    sourceSampleOnly: isSampleOnlySnapshot(source),
    targetEmpty: isSnapshotEmpty(target),
    hasConflicts: conflictingNoteIds.size > 0,
    sourceCounts: buildCounts(source),
    targetCounts: buildCounts(target),
  };
};

const computeBlockMs = (attempts: number): number | null => {
  if (attempts < THROTTLE_THRESHOLD) {
    return null;
  }

  const power = attempts - THROTTLE_THRESHOLD;
  return Math.min(MAX_BLOCK_MS, BASE_BLOCK_MS * 2 ** power);
};

const toRateLimitDetails = (
  blockedUntilMs: number,
  nowMs: number,
): Readonly<{ retryAfterSeconds: number; resetAt: number }> => {
  return {
    retryAfterSeconds: Math.max(1, Math.ceil((blockedUntilMs - nowMs) / 1000)),
    resetAt: blockedUntilMs,
  };
};

const throwRateLimit = (blockedUntilMs: number, nowMs: number): never => {
  throw new AppError({
    code: 'rate_limit',
    details: toRateLimitDetails(blockedUntilMs, nowMs),
  });
};

const throwAuthError = (): never => {
  throw new AppError({
    code: 'auth',
    message: 'Invalid merge credentials',
  });
};

const authorizeTargetAccount = async (
  transaction: MergeRepositoryTransaction,
  input: MergePreflightInput,
  now: Date,
  verifyPasswordFn: VerifyPasswordFn,
): Promise<void> => {
  const nowMs = now.getTime();
  const attempt = await transaction.lockMigrationAttemptByKey(input.toUserId);

  if (attempt.blockedUntil && attempt.blockedUntil.getTime() > nowMs) {
    throwRateLimit(attempt.blockedUntil.getTime(), nowMs);
  }

  const user = await transaction.lockTargetUserById(input.toUserId);
  const usernameMatches = user !== null && user.username === input.username;

  const verified =
    user === null || !usernameMatches
      ? false
      : (await verifyPasswordFn(input.password, user.passwordHash)).verified;

  if (!verified) {
    const nextAttempts = attempt.attempts + 1;
    const blockMs = computeBlockMs(nextAttempts);
    const blockedUntil = blockMs === null ? null : new Date(nowMs + blockMs);

    await transaction.updateMigrationAttempt({
      key: input.toUserId,
      attempts: nextAttempts,
      blockedUntil,
    });

    if (blockedUntil) {
      throwRateLimit(blockedUntil.getTime(), nowMs);
    }

    throwAuthError();
  }

  if (attempt.attempts !== 0 || attempt.blockedUntil !== null) {
    await transaction.updateMigrationAttempt({
      key: input.toUserId,
      attempts: 0,
      blockedUntil: null,
    });
  }
};

const resolveApplyStrategy = (
  summary: MergeSummary,
  requestedStrategy: MergeApplyInput['strategy'],
): Readonly<{ strategy: MergeApplyInput['strategy']; resolution: MergeResolution }> => {
  if (requestedStrategy !== 'both') {
    return {
      strategy: requestedStrategy,
      resolution: requestedStrategy,
    };
  }

  const resolution = resolveMergeResolution(summary);
  if (resolution === 'cloud') {
    return {
      strategy: 'cloud',
      resolution,
    };
  }

  if (resolution === 'local') {
    return {
      strategy: 'local',
      resolution,
    };
  }

  return {
    strategy: 'both',
    resolution,
  };
};

export const createMergeService = (deps: MergeServiceDeps = {}): MergeService => {
  const repository = deps.repository ?? createMergeRepository();
  const now = deps.now ?? (() => new Date());
  const verifyPasswordFn = deps.verifyPasswordFn ?? verifyPassword;

  return {
    preflight: async (input) => {
      return await repository.withTransaction(async (transaction) => {
        await authorizeTargetAccount(transaction, input, now(), verifyPasswordFn);

        const source = await transaction.readSnapshotForUser(input.fromUserId);
        const target = await transaction.readSnapshotForUser(input.toUserId);

        return {
          summary: toSummary(source, target),
        };
      });
    },

    apply: async (input) => {
      return await repository.withTransaction(async (transaction) => {
        await authorizeTargetAccount(transaction, input, now(), verifyPasswordFn);

        const source = await transaction.readSnapshotForUser(input.fromUserId);
        const target = await transaction.readSnapshotForUser(input.toUserId);
        const summary = toSummary(source, target);
        const strategy = resolveApplyStrategy(summary, input.strategy);

        if (strategy.strategy === 'local') {
          await transaction.replaceTargetWithSource({
            sourceUserId: input.fromUserId,
            targetUserId: input.toUserId,
          });
        }

        if (strategy.strategy === 'both') {
          const conflictingNoteIds = getConflictingNoteIds(source, target);
          await transaction.mergeSourceIntoTarget({
            source,
            target,
            targetUserId: input.toUserId,
            conflictingNoteIds,
          });
        }

        const finalTarget = await transaction.readSnapshotForUser(input.toUserId);

        return {
          strategy: strategy.strategy,
          resolution: strategy.resolution,
          summary: toSummary(source, finalTarget),
        };
      });
    },
  };
};
