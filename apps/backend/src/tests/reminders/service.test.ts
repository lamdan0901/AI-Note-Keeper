import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '../../middleware/error-middleware.js';
import type { NoteChangeEventsRepository } from '../../notes/repositories/note-change-events-repository.js';
import type {
  ReminderCreateInput,
  ReminderPatchInput,
  ReminderRecord,
  ReminderRepeatRule,
  ReminderUpdatePayload,
} from '../../reminders/contracts.js';
import type { RemindersRepository } from '../../reminders/repositories/reminders-repository.js';
import { createRemindersService } from '../../reminders/service.js';

type InMemoryRemindersRepository = RemindersRepository &
  Readonly<{
    byKey: Map<string, ReminderRecord>;
    createCalls: ReminderCreateInput[];
    patchCalls: ReminderPatchInput[];
  }>;

const createReminderRecord = (
  input: Readonly<{
    id: string;
    userId: string;
    updatedAt: number;
    timezone?: string;
    title?: string | null;
    repeat?: ReminderRepeatRule | null;
    startAt?: Date | null;
    baseAtLocal?: string | null;
    nextTriggerAt?: Date | null;
    snoozedUntil?: Date | null;
    done?: boolean | null;
    scheduleStatus?: string;
    version?: number;
  }>,
): ReminderRecord => {
  const updatedAt = new Date(input.updatedAt);

  return {
    id: input.id,
    userId: input.userId,
    title: input.title ?? null,
    triggerAt: new Date(input.updatedAt),
    done: input.done ?? null,
    repeatRule: input.repeat ? input.repeat.kind : 'none',
    repeatConfig: null,
    repeat: input.repeat ?? null,
    snoozedUntil: input.snoozedUntil ?? null,
    active: true,
    scheduleStatus: input.scheduleStatus ?? 'scheduled',
    timezone: input.timezone ?? 'UTC',
    baseAtLocal: input.baseAtLocal ?? null,
    startAt: input.startAt ?? null,
    nextTriggerAt: input.nextTriggerAt ?? null,
    lastFiredAt: null,
    lastAcknowledgedAt: null,
    version: input.version ?? 1,
    createdAt: updatedAt,
    updatedAt,
  };
};

const createInMemoryRemindersRepository = (
  initial: ReadonlyArray<ReminderRecord>,
): InMemoryRemindersRepository => {
  const byKey = new Map<string, ReminderRecord>();
  const createCalls: ReminderCreateInput[] = [];
  const patchCalls: ReminderPatchInput[] = [];

  initial.forEach((record) => {
    byKey.set(`${record.userId}:${record.id}`, record);
  });

  return {
    byKey,
    createCalls,
    patchCalls,
    listByUser: async ({ userId, updatedSince }) => {
      return [...byKey.values()].filter((item) => {
        if (item.userId !== userId) {
          return false;
        }

        if (!updatedSince) {
          return true;
        }

        return item.updatedAt.getTime() > updatedSince.getTime();
      });
    },
    findByIdForUser: async ({ reminderId, userId }) => {
      return byKey.get(`${userId}:${reminderId}`) ?? null;
    },
    create: async (input) => {
      createCalls.push(input);
      const created: ReminderRecord = {
        id: input.id,
        userId: input.userId,
        title: input.title,
        triggerAt: input.triggerAt,
        done: input.done,
        repeatRule: input.repeatRule,
        repeatConfig: input.repeatConfig,
        repeat: input.repeat,
        snoozedUntil: input.snoozedUntil,
        active: input.active,
        scheduleStatus: input.scheduleStatus,
        timezone: input.timezone,
        baseAtLocal: input.baseAtLocal,
        startAt: input.startAt,
        nextTriggerAt: input.nextTriggerAt,
        lastFiredAt: input.lastFiredAt,
        lastAcknowledgedAt: input.lastAcknowledgedAt,
        version: input.version,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      };

      byKey.set(`${created.userId}:${created.id}`, created);
      return created;
    },
    patch: async ({ reminderId, userId, patch }) => {
      patchCalls.push(patch);
      const existing = byKey.get(`${userId}:${reminderId}`);
      if (!existing) {
        return null;
      }

      const next: ReminderRecord = {
        ...existing,
        ...(Object.hasOwn(patch, 'title') ? { title: patch.title ?? null } : {}),
        ...(Object.hasOwn(patch, 'triggerAt')
          ? { triggerAt: patch.triggerAt ?? existing.triggerAt }
          : {}),
        ...(Object.hasOwn(patch, 'done') ? { done: patch.done ?? null } : {}),
        ...(Object.hasOwn(patch, 'repeatRule') ? { repeatRule: patch.repeatRule ?? null } : {}),
        ...(Object.hasOwn(patch, 'repeatConfig')
          ? { repeatConfig: patch.repeatConfig ?? null }
          : {}),
        ...(Object.hasOwn(patch, 'repeat') ? { repeat: patch.repeat ?? null } : {}),
        ...(Object.hasOwn(patch, 'snoozedUntil')
          ? { snoozedUntil: patch.snoozedUntil ?? null }
          : {}),
        ...(Object.hasOwn(patch, 'active') ? { active: patch.active ?? existing.active } : {}),
        ...(Object.hasOwn(patch, 'scheduleStatus')
          ? { scheduleStatus: patch.scheduleStatus ?? existing.scheduleStatus }
          : {}),
        ...(Object.hasOwn(patch, 'timezone')
          ? { timezone: patch.timezone ?? existing.timezone }
          : {}),
        ...(Object.hasOwn(patch, 'baseAtLocal') ? { baseAtLocal: patch.baseAtLocal ?? null } : {}),
        ...(Object.hasOwn(patch, 'startAt') ? { startAt: patch.startAt ?? null } : {}),
        ...(Object.hasOwn(patch, 'nextTriggerAt')
          ? { nextTriggerAt: patch.nextTriggerAt ?? null }
          : {}),
        ...(Object.hasOwn(patch, 'lastFiredAt') ? { lastFiredAt: patch.lastFiredAt ?? null } : {}),
        ...(Object.hasOwn(patch, 'lastAcknowledgedAt')
          ? { lastAcknowledgedAt: patch.lastAcknowledgedAt ?? null }
          : {}),
        ...(Object.hasOwn(patch, 'version') ? { version: patch.version ?? existing.version } : {}),
        ...(Object.hasOwn(patch, 'updatedAt')
          ? { updatedAt: patch.updatedAt ?? existing.updatedAt }
          : {}),
      };

      byKey.set(`${userId}:${reminderId}`, next);
      return next;
    },
    deleteByIdForUser: async ({ reminderId, userId }) => {
      return byKey.delete(`${userId}:${reminderId}`);
    },
  };
};

const createChangeEventsDouble = () => {
  const seen = new Set<string>();
  const appended: string[] = [];

  const repository: NoteChangeEventsRepository = {
    isDuplicate: async (input) => {
      const { noteId, userId, operation, payloadHash } = input;
      return seen.has(`${noteId}:${userId}:${operation}:${payloadHash}`);
    },
    appendEvent: async (input) => {
      const { noteId, userId, operation, payloadHash } = input;
      const key = `${noteId}:${userId}:${operation}:${payloadHash}`;
      seen.add(key);
      appended.push(key);
    },
  };

  return { appended, repository };
};

test('invalid timezone on create and update throws validation error without mutation', async () => {
  const repository = createInMemoryRemindersRepository([
    createReminderRecord({
      id: 'reminder-1',
      userId: 'user-1',
      updatedAt: 1_700_000_000_000,
      timezone: 'UTC',
    }),
  ]);
  const events = createChangeEventsDouble();

  const service = createRemindersService({
    remindersRepository: repository,
    noteChangeEventsRepository: events.repository,
    now: () => new Date(1_700_000_100_000),
  });

  await assert.rejects(
    async () => {
      await service.createReminder({
        userId: 'user-1',
        id: 'new-reminder',
        triggerAt: 1_700_000_100_000,
        active: true,
        timezone: 'invalid-zone',
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'validation');
      return true;
    },
  );

  await assert.rejects(
    async () => {
      await service.updateReminder({
        userId: 'user-1',
        reminderId: 'reminder-1',
        patch: {
          updatedAt: 1_700_000_200_000,
          timezone: 'Mars/Olympus',
        },
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'validation');
      return true;
    },
  );

  assert.equal(repository.createCalls.length, 0);
  assert.equal(repository.patchCalls.length, 0);
  assert.equal(events.appended.length, 0);
});

test('recurrence definition updates recompute nextTriggerAt and ignore client nextTriggerAt', async () => {
  const repository = createInMemoryRemindersRepository([
    createReminderRecord({
      id: 'reminder-1',
      userId: 'user-1',
      updatedAt: 1_700_000_000_000,
      timezone: 'UTC',
      repeat: { kind: 'daily', interval: 1 },
      startAt: new Date(1_700_000_000_000),
      baseAtLocal: '2026-01-01T09:00:00',
      nextTriggerAt: new Date(1_700_000_100_000),
    }),
  ]);
  const events = createChangeEventsDouble();
  const changed: string[] = [];

  const service = createRemindersService({
    remindersRepository: repository,
    noteChangeEventsRepository: events.repository,
    computeNext: () => 1_700_000_999_000,
    onReminderChanged: ({ reminder }) => {
      changed.push(reminder.id);
    },
    now: () => new Date(1_700_000_500_000),
  });

  const updated = await service.updateReminder({
    userId: 'user-1',
    reminderId: 'reminder-1',
    patch: {
      updatedAt: 1_700_000_600_000,
      repeat: { kind: 'weekly', interval: 1, weekdays: [1, 3, 5] },
      startAt: 1_700_000_000_000,
      baseAtLocal: '2026-01-01T10:00:00',
      nextTriggerAt: 1_700_000_111_000,
    },
  });

  assert.ok(updated);
  assert.equal(updated.nextTriggerAt?.getTime(), 1_700_000_999_000);
  assert.equal(updated.repeat?.kind, 'weekly');
  assert.equal(repository.patchCalls.length, 1);
  assert.equal(repository.patchCalls[0].nextTriggerAt?.getTime(), 1_700_000_999_000);
  assert.equal(events.appended.length, 1);
  assert.deepEqual(changed, ['reminder-1']);
});

test('stale and equal timestamp updates are idempotent no-ops with no change events', async () => {
  const repository = createInMemoryRemindersRepository([
    createReminderRecord({
      id: 'reminder-1',
      userId: 'user-1',
      updatedAt: 1_700_000_300_000,
      title: 'Current',
      timezone: 'UTC',
    }),
  ]);
  const events = createChangeEventsDouble();

  const service = createRemindersService({
    remindersRepository: repository,
    noteChangeEventsRepository: events.repository,
  });

  const stale = await service.updateReminder({
    userId: 'user-1',
    reminderId: 'reminder-1',
    patch: {
      updatedAt: 1_700_000_200_000,
      title: 'Should not win',
    },
  });

  const equal = await service.updateReminder({
    userId: 'user-1',
    reminderId: 'reminder-1',
    patch: {
      updatedAt: 1_700_000_300_000,
      title: 'Should still not win',
    },
  });

  assert.equal(stale?.title, 'Current');
  assert.equal(equal?.title, 'Current');
  assert.equal(repository.patchCalls.length, 0);
  assert.equal(events.appended.length, 0);
});

test('ack and snooze mutate expected fields while preserving recurrence definition fields', async () => {
  const baseReminder = createReminderRecord({
    id: 'reminder-1',
    userId: 'user-1',
    updatedAt: 1_700_000_000_000,
    timezone: 'UTC',
    repeat: { kind: 'daily', interval: 1 },
    startAt: new Date(1_700_000_000_000),
    baseAtLocal: '2026-01-01T09:00:00',
    nextTriggerAt: new Date(1_700_000_100_000),
    scheduleStatus: 'scheduled',
    version: 2,
  });

  const repository = createInMemoryRemindersRepository([baseReminder]);
  const events = createChangeEventsDouble();

  const service = createRemindersService({
    remindersRepository: repository,
    noteChangeEventsRepository: events.repository,
    computeNext: () => 1_700_000_800_000,
    now: () => new Date(1_700_000_500_000),
  });

  const acked = await service.ackReminder({
    userId: 'user-1',
    reminderId: 'reminder-1',
    ackType: 'done',
  });

  assert.ok(acked);
  assert.equal(acked.done, true);
  assert.equal(acked.scheduleStatus, 'scheduled');
  assert.equal(acked.nextTriggerAt?.getTime(), 1_700_000_800_000);
  assert.equal(acked.lastAcknowledgedAt?.getTime(), 1_700_000_500_000);
  assert.equal(acked.lastFiredAt?.getTime(), 1_700_000_500_000);

  const snoozed = await service.snoozeReminder({
    userId: 'user-1',
    reminderId: 'reminder-1',
    snoozedUntil: 1_700_000_900_000,
  });

  assert.ok(snoozed);
  assert.equal(snoozed.snoozedUntil?.getTime(), 1_700_000_900_000);
  assert.equal(snoozed.nextTriggerAt?.getTime(), 1_700_000_900_000);
  assert.equal(snoozed.scheduleStatus, 'scheduled');
  assert.equal(snoozed.active, true);
  assert.deepEqual(snoozed.repeat, { kind: 'daily', interval: 1 });
  assert.equal(snoozed.startAt?.getTime(), 1_700_000_000_000);
  assert.equal(snoozed.baseAtLocal, '2026-01-01T09:00:00');

  assert.equal(events.appended.length, 2);
  assert.equal(repository.patchCalls.length, 2);
  assert.equal(Object.hasOwn(repository.patchCalls[1], 'repeat'), false);
  assert.equal(Object.hasOwn(repository.patchCalls[1], 'startAt'), false);
  assert.equal(Object.hasOwn(repository.patchCalls[1], 'baseAtLocal'), false);
});

test('event dedupe key and immediate callback trigger only on effective change', async () => {
  const repository = createInMemoryRemindersRepository([
    createReminderRecord({
      id: 'reminder-1',
      userId: 'user-1',
      updatedAt: 1_700_000_000_000,
      title: 'Before',
      timezone: 'UTC',
    }),
  ]);

  const events = createChangeEventsDouble();
  const callbacks: string[] = [];

  const service = createRemindersService({
    remindersRepository: repository,
    noteChangeEventsRepository: events.repository,
    onReminderChanged: ({ operation }) => {
      callbacks.push(operation);
    },
  });

  const first = await service.updateReminder({
    userId: 'user-1',
    reminderId: 'reminder-1',
    patch: {
      updatedAt: 1_700_000_100_000,
      title: 'After',
    } satisfies ReminderUpdatePayload,
  });

  const noop = await service.updateReminder({
    userId: 'user-1',
    reminderId: 'reminder-1',
    patch: {
      updatedAt: 1_700_000_200_000,
      title: 'After',
    } satisfies ReminderUpdatePayload,
  });

  assert.equal(first?.title, 'After');
  assert.equal(noop?.title, 'After');
  assert.equal(events.appended.length, 1);
  assert.equal(events.appended[0].startsWith('reminder-1:user-1:update:'), true);
  assert.deepEqual(callbacks, ['update']);
});
