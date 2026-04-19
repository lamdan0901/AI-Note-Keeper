import assert from 'node:assert/strict';
import test from 'node:test';

import type { MergeApplyInput } from '../../merge/contracts.js';
import { createMergeService } from '../../merge/service.js';
import type {
  MergeEventRecord,
  MergeNoteRecord,
  MergeRepository,
  MergeRepositoryTransaction,
  MergeSnapshot,
  MergeSubscriptionRecord,
  MergeTokenRecord,
  MergeUserRecord,
  MigrationAttemptRecord,
} from '../../merge/repositories/merge-repository.js';
import { AppError } from '../../middleware/error-middleware.js';

type AttemptState = {
  id: string;
  key: string;
  attempts: number;
  blockedUntil: Date | null;
  lastAttemptAt: Date | null;
};

type RepoStats = {
  beginCount: number;
  commitCount: number;
  rollbackCount: number;
  lockAttemptKeys: string[];
  lockUserIds: string[];
  replaceCalls: number;
  mergeCalls: number;
  mergeSourceUserIds: string[];
};

const createNote = (
  input: Readonly<{
    id: string;
    userId: string;
    title?: string | null;
    content?: string | null;
    active?: boolean;
    updatedAt?: number;
  }>,
): MergeNoteRecord => {
  const timestamp = new Date(input.updatedAt ?? 1_700_000_000_000);
  return {
    id: input.id,
    userId: input.userId,
    title: input.title ?? null,
    content: input.content ?? null,
    contentType: 'text/plain',
    color: null,
    active: input.active ?? true,
    done: false,
    isPinned: false,
    triggerAt: null,
    repeatRule: null,
    repeatConfig: null,
    repeat: null,
    snoozedUntil: null,
    scheduleStatus: null,
    timezone: 'UTC',
    baseAtLocal: null,
    startAt: null,
    nextTriggerAt: null,
    lastFiredAt: null,
    lastAcknowledgedAt: null,
    version: 1,
    deletedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

const createSubscription = (
  input: Readonly<{ id: string; userId: string; serviceName?: string }>,
): MergeSubscriptionRecord => {
  const now = new Date(1_700_000_000_000);
  return {
    id: input.id,
    userId: input.userId,
    serviceName: input.serviceName ?? 'Spotify',
    category: 'music',
    price: 9.99,
    currency: 'USD',
    billingCycle: 'monthly',
    billingCycleCustomDays: null,
    nextBillingDate: now,
    notes: null,
    trialEndDate: null,
    status: 'active',
    reminderDaysBefore: [1],
    nextReminderAt: null,
    lastNotifiedBillingDate: null,
    nextTrialReminderAt: null,
    lastNotifiedTrialEndDate: null,
    active: true,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
};

const createToken = (
  input: Readonly<{ id: string; userId: string; deviceId: string }>,
): MergeTokenRecord => {
  const now = new Date(1_700_000_000_000);
  return {
    id: input.id,
    userId: input.userId,
    deviceId: input.deviceId,
    fcmToken: `${input.deviceId}-fcm`,
    platform: 'android',
    updatedAt: now,
    createdAt: now,
  };
};

const createEvent = (
  input: Readonly<{ id: string; noteId: string; userId: string }>,
): MergeEventRecord => {
  return {
    id: input.id,
    noteId: input.noteId,
    userId: input.userId,
    operation: 'create',
    changedAt: new Date(1_700_000_000_000),
    deviceId: 'device-1',
    payloadHash: 'payload-hash',
  };
};

const emptySnapshot = (): MergeSnapshot => ({
  notes: [],
  subscriptions: [],
  tokens: [],
  events: [],
});

const cloneSnapshot = (snapshot: MergeSnapshot): MergeSnapshot => {
  return {
    notes: [...snapshot.notes],
    subscriptions: [...snapshot.subscriptions],
    tokens: [...snapshot.tokens],
    events: [...snapshot.events],
  };
};

const createRepositoryDouble = (
  input: Readonly<{
    users: MergeUserRecord[];
    snapshots?: Record<string, MergeSnapshot>;
  }>,
): Readonly<{ repository: MergeRepository; stats: RepoStats }> => {
  const users = new Map(input.users.map((user) => [user.id, user]));
  const attempts = new Map<string, AttemptState>();
  const snapshots = new Map<string, MergeSnapshot>(
    Object.entries(input.snapshots ?? {}).map(([userId, snapshot]) => [
      userId,
      cloneSnapshot(snapshot),
    ]),
  );

  const stats: RepoStats = {
    beginCount: 0,
    commitCount: 0,
    rollbackCount: 0,
    lockAttemptKeys: [],
    lockUserIds: [],
    replaceCalls: 0,
    mergeCalls: 0,
    mergeSourceUserIds: [],
  };

  const createTransaction = (): MergeRepositoryTransaction => {
    return {
      lockMigrationAttemptByKey: async (key) => {
        stats.lockAttemptKeys.push(key);

        const existing = attempts.get(key);
        if (existing) {
          return {
            id: existing.id,
            key: existing.key,
            attempts: existing.attempts,
            lastAttemptAt: existing.lastAttemptAt,
            blockedUntil: existing.blockedUntil,
          };
        }

        const created: AttemptState = {
          id: `attempt-${key}`,
          key,
          attempts: 0,
          blockedUntil: null,
          lastAttemptAt: new Date(1_700_000_000_000),
        };
        attempts.set(key, created);

        return {
          id: created.id,
          key: created.key,
          attempts: created.attempts,
          lastAttemptAt: created.lastAttemptAt,
          blockedUntil: created.blockedUntil,
        };
      },

      updateMigrationAttempt: async ({ key, attempts: count, blockedUntil }) => {
        const existing = attempts.get(key) ?? {
          id: `attempt-${key}`,
          key,
          attempts: 0,
          blockedUntil: null,
          lastAttemptAt: null,
        };

        const next: AttemptState = {
          ...existing,
          attempts: count,
          blockedUntil,
          lastAttemptAt: new Date(1_700_000_000_000),
        };
        attempts.set(key, next);

        return {
          id: next.id,
          key: next.key,
          attempts: next.attempts,
          lastAttemptAt: next.lastAttemptAt,
          blockedUntil: next.blockedUntil,
        } as MigrationAttemptRecord;
      },

      lockTargetUserById: async (userId) => {
        stats.lockUserIds.push(userId);
        return users.get(userId) ?? null;
      },

      readSnapshotForUser: async (userId) => {
        return cloneSnapshot(snapshots.get(userId) ?? emptySnapshot());
      },

      replaceTargetWithSource: async ({ sourceUserId, targetUserId }) => {
        stats.replaceCalls += 1;
        const source = cloneSnapshot(snapshots.get(sourceUserId) ?? emptySnapshot());

        snapshots.set(targetUserId, {
          notes: source.notes.map((note) => ({ ...note, userId: targetUserId })),
          subscriptions: source.subscriptions.map((item) => ({ ...item, userId: targetUserId })),
          tokens: source.tokens.map((item) => ({ ...item, userId: targetUserId })),
          events: source.events.map((item) => ({ ...item, userId: targetUserId })),
        });
      },

      mergeSourceIntoTarget: async ({
        source,
        target,
        sourceUserId,
        targetUserId,
        conflictingNoteIds,
      }) => {
        stats.mergeCalls += 1;
        stats.mergeSourceUserIds.push(sourceUserId);

        const byTargetNoteId = new Map(target.notes.map((note) => [note.id, note]));
        const mergedNotes = [...target.notes];

        for (const sourceNote of source.notes) {
          const existingTarget = byTargetNoteId.get(sourceNote.id);
          if (!existingTarget) {
            mergedNotes.push({ ...sourceNote, userId: targetUserId });
            continue;
          }

          if (!conflictingNoteIds.has(sourceNote.id)) {
            continue;
          }

          mergedNotes.push({
            ...sourceNote,
            id: `${sourceNote.id}-local-copy`,
            userId: targetUserId,
            title: sourceNote.title ? `${sourceNote.title} (Local copy)` : 'Local copy',
          });
        }

        snapshots.set(targetUserId, {
          notes: mergedNotes,
          subscriptions: [
            ...target.subscriptions,
            ...source.subscriptions.map((item) => ({ ...item, userId: targetUserId })),
          ],
          tokens: [
            ...target.tokens,
            ...source.tokens.map((item) => ({ ...item, userId: targetUserId })),
          ],
          events: [
            ...target.events,
            ...source.events.map((item) => ({ ...item, userId: targetUserId })),
          ],
        });
      },
    };
  };

  const repository: MergeRepository = {
    withTransaction: async (operation) => {
      stats.beginCount += 1;
      const transaction = createTransaction();

      try {
        const result = await operation(transaction);
        stats.commitCount += 1;
        return result;
      } catch (error) {
        stats.rollbackCount += 1;
        throw error;
      }
    },
  };

  return { repository, stats };
};

const validUser: MergeUserRecord = {
  id: 'target-user',
  username: 'alice',
  passwordHash: 'stored-hash',
};

const validPasswordCheck = async (
  password: string,
  storedHash: string,
): Promise<Readonly<{ verified: boolean; needsUpgrade: boolean; algorithm: 'argon2id' }>> => {
  return {
    verified: password === 'correct-password' && storedHash === 'stored-hash',
    needsUpgrade: false,
    algorithm: 'argon2id',
  };
};

test('preflight returns parity summary fields and count metadata', async () => {
  const { repository } = createRepositoryDouble({
    users: [validUser],
    snapshots: {
      'source-user': {
        notes: [
          createNote({
            id: 'welcome-note',
            userId: 'source-user',
            title: 'Welcome to AI Note Keeper',
            content: 'This is your first note. Edit or delete it anytime.',
          }),
        ],
        subscriptions: [],
        tokens: [],
        events: [],
      },
      'target-user': emptySnapshot(),
    },
  });

  const service = createMergeService({
    repository,
    verifyPasswordFn: validPasswordCheck,
  });

  const result = await service.preflight({
    fromUserId: 'source-user',
    toUserId: 'target-user',
    username: 'alice',
    password: 'correct-password',
  });

  assert.deepEqual(result.summary, {
    sourceEmpty: false,
    sourceSampleOnly: true,
    targetEmpty: true,
    hasConflicts: false,
    sourceCounts: {
      notes: 1,
      subscriptions: 0,
      tokens: 0,
      events: 0,
    },
    targetCounts: {
      notes: 0,
      subscriptions: 0,
      tokens: 0,
      events: 0,
    },
  });
});

test('preflight rejects same-account merge before transaction state changes', async () => {
  const { repository, stats } = createRepositoryDouble({
    users: [validUser],
    snapshots: {
      'target-user': emptySnapshot(),
    },
  });

  const service = createMergeService({
    repository,
    verifyPasswordFn: validPasswordCheck,
  });

  await assert.rejects(
    service.preflight({
      fromUserId: 'target-user',
      toUserId: 'target-user',
      username: 'alice',
      password: 'correct-password',
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'validation');
      return true;
    },
  );

  assert.equal(stats.beginCount, 0);
  assert.equal(stats.commitCount, 0);
  assert.equal(stats.rollbackCount, 0);
});

test('apply executes inside one explicit transaction and commits atomically per request', async () => {
  const { repository, stats } = createRepositoryDouble({
    users: [validUser],
    snapshots: {
      'source-user': {
        notes: [createNote({ id: 'n-1', userId: 'source-user', title: 'Local note' })],
        subscriptions: [createSubscription({ id: 's-1', userId: 'source-user' })],
        tokens: [createToken({ id: 't-1', userId: 'source-user', deviceId: 'device-1' })],
        events: [createEvent({ id: 'e-1', noteId: 'n-1', userId: 'source-user' })],
      },
      'target-user': {
        notes: [createNote({ id: 'n-old', userId: 'target-user', title: 'Cloud note' })],
        subscriptions: [],
        tokens: [],
        events: [],
      },
    },
  });

  const service = createMergeService({
    repository,
    verifyPasswordFn: validPasswordCheck,
  });

  const result = await service.apply({
    fromUserId: 'source-user',
    toUserId: 'target-user',
    username: 'alice',
    password: 'correct-password',
    strategy: 'local',
  });

  assert.equal(result.strategy, 'local');
  assert.equal(stats.beginCount, 1);
  assert.equal(stats.commitCount, 1);
  assert.equal(stats.rollbackCount, 0);
  assert.equal(stats.replaceCalls, 1);
});

test('apply rejects same-account merge before mutation and transaction start', async () => {
  const { repository, stats } = createRepositoryDouble({
    users: [validUser],
    snapshots: {
      'target-user': {
        notes: [createNote({ id: 'n-1', userId: 'target-user', title: 'existing' })],
        subscriptions: [createSubscription({ id: 's-1', userId: 'target-user' })],
        tokens: [createToken({ id: 't-1', userId: 'target-user', deviceId: 'device-1' })],
        events: [createEvent({ id: 'e-1', noteId: 'n-1', userId: 'target-user' })],
      },
    },
  });

  const service = createMergeService({
    repository,
    verifyPasswordFn: validPasswordCheck,
  });

  await assert.rejects(
    service.apply({
      fromUserId: 'target-user',
      toUserId: 'target-user',
      username: 'alice',
      password: 'correct-password',
      strategy: 'local',
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'validation');
      return true;
    },
  );

  assert.equal(stats.beginCount, 0);
  assert.equal(stats.commitCount, 0);
  assert.equal(stats.rollbackCount, 0);
  assert.equal(stats.replaceCalls, 0);
  assert.equal(stats.mergeCalls, 0);
});

test('strategy both uses canonical shared resolution semantics', async () => {
  const conflictRepo = createRepositoryDouble({
    users: [validUser],
    snapshots: {
      'source-user': {
        notes: [
          createNote({
            id: 'same-note',
            userId: 'source-user',
            title: 'Local draft',
            content: 'local',
          }),
        ],
        subscriptions: [],
        tokens: [],
        events: [],
      },
      'target-user': {
        notes: [
          createNote({
            id: 'same-note',
            userId: 'target-user',
            title: 'Cloud draft',
            content: 'cloud',
          }),
        ],
        subscriptions: [],
        tokens: [],
        events: [],
      },
    },
  });

  const conflictService = createMergeService({
    repository: conflictRepo.repository,
    verifyPasswordFn: validPasswordCheck,
  });

  const conflictResult = await conflictService.apply({
    fromUserId: 'source-user',
    toUserId: 'target-user',
    username: 'alice',
    password: 'correct-password',
    strategy: 'both',
  });

  assert.equal(conflictResult.resolution, 'prompt');
  assert.equal(conflictResult.strategy, 'both');
  assert.equal(conflictRepo.stats.mergeCalls, 1);

  const sampleOnlyRepo = createRepositoryDouble({
    users: [validUser],
    snapshots: {
      'source-user': {
        notes: [
          createNote({
            id: 'welcome-note',
            userId: 'source-user',
            title: 'Welcome to AI Note Keeper',
            content: 'This is your first note. Edit or delete it anytime.',
          }),
        ],
        subscriptions: [],
        tokens: [],
        events: [],
      },
      'target-user': {
        notes: [createNote({ id: 'cloud-note', userId: 'target-user', title: 'Cloud data' })],
        subscriptions: [],
        tokens: [],
        events: [],
      },
    },
  });

  const sampleOnlyService = createMergeService({
    repository: sampleOnlyRepo.repository,
    verifyPasswordFn: validPasswordCheck,
  });

  const sampleOnlyResult = await sampleOnlyService.apply({
    fromUserId: 'source-user',
    toUserId: 'target-user',
    username: 'alice',
    password: 'correct-password',
    strategy: 'both',
  });

  assert.equal(sampleOnlyResult.resolution, 'cloud');
  assert.equal(sampleOnlyResult.strategy, 'cloud');
  assert.equal(sampleOnlyRepo.stats.mergeCalls, 0);
  assert.equal(sampleOnlyRepo.stats.replaceCalls, 0);
});

test('strategy both passes explicit sourceUserId for event-only source snapshots', async () => {
  const { repository, stats } = createRepositoryDouble({
    users: [validUser],
    snapshots: {
      'source-user': {
        notes: [],
        subscriptions: [],
        tokens: [],
        events: [createEvent({ id: 'e-1', noteId: 'orphan-note', userId: 'source-user' })],
      },
      'target-user': {
        notes: [],
        subscriptions: [createSubscription({ id: 's-1', userId: 'target-user' })],
        tokens: [],
        events: [],
      },
    },
  });

  const service = createMergeService({
    repository,
    verifyPasswordFn: validPasswordCheck,
  });

  const result = await service.apply({
    fromUserId: 'source-user',
    toUserId: 'target-user',
    username: 'alice',
    password: 'correct-password',
    strategy: 'both',
  });

  assert.equal(result.strategy, 'both');
  assert.equal(stats.mergeCalls, 1);
  assert.deepEqual(stats.mergeSourceUserIds, ['source-user']);
});

test('throttle is keyed by toUserId and uses threshold 3 with 60s base backoff', async () => {
  const { repository } = createRepositoryDouble({
    users: [
      validUser,
      {
        id: 'target-user-2',
        username: 'bob',
        passwordHash: 'stored-hash-bob',
      },
    ],
    snapshots: {
      'source-user': emptySnapshot(),
      'target-user': emptySnapshot(),
      'target-user-2': emptySnapshot(),
    },
  });

  const fixedNow = new Date(1_700_000_000_000);
  const service = createMergeService({
    repository,
    now: () => fixedNow,
    verifyPasswordFn: async () => ({
      verified: false,
      needsUpgrade: false,
      algorithm: 'argon2id',
    }),
  });

  const failingInput: MergeApplyInput = {
    fromUserId: 'source-user',
    toUserId: 'target-user',
    username: 'alice',
    password: 'wrong',
    strategy: 'local',
  };

  await assert.rejects(service.apply(failingInput), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, 'auth');
    return true;
  });

  await assert.rejects(service.apply(failingInput), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, 'auth');
    return true;
  });

  await assert.rejects(service.apply(failingInput), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, 'rate_limit');
    assert.equal(error.details?.retryAfterSeconds, 60);
    assert.equal(error.details?.resetAt, fixedNow.getTime() + 60_000);
    return true;
  });

  await assert.rejects(service.apply(failingInput), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, 'rate_limit');
    return true;
  });

  await assert.rejects(
    service.apply({
      ...failingInput,
      toUserId: 'target-user-2',
      username: 'bob',
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'auth');
      return true;
    },
  );
});

test('concurrent apply attempts lock migration-attempt and target-user rows', async () => {
  const { repository, stats } = createRepositoryDouble({
    users: [validUser],
    snapshots: {
      'source-user': {
        notes: [createNote({ id: 'n-1', userId: 'source-user', title: 'source' })],
        subscriptions: [],
        tokens: [],
        events: [],
      },
      'target-user': emptySnapshot(),
    },
  });

  const service = createMergeService({
    repository,
    verifyPasswordFn: validPasswordCheck,
  });

  await Promise.all([
    service.apply({
      fromUserId: 'source-user',
      toUserId: 'target-user',
      username: 'alice',
      password: 'correct-password',
      strategy: 'local',
    }),
    service.apply({
      fromUserId: 'source-user',
      toUserId: 'target-user',
      username: 'alice',
      password: 'correct-password',
      strategy: 'local',
    }),
  ]);

  assert.equal(stats.lockAttemptKeys.filter((value) => value === 'target-user').length, 2);
  assert.equal(stats.lockUserIds.filter((value) => value === 'target-user').length, 2);
  assert.equal(stats.beginCount, 2);
  assert.equal(stats.commitCount, 2);
});
