import assert from 'node:assert/strict';

const hasOwn = (value: object, key: string): boolean => {
  return Object.prototype.hasOwnProperty.call(value, key);
};

type ReminderRecord = Readonly<{
  id: string;
  userId: string;
  title: string | null;
  triggerAt: Date;
  done: boolean | null;
  repeatRule: string | null;
  repeatConfig: Record<string, unknown> | null;
  repeat: Record<string, unknown> | null;
  snoozedUntil: Date | null;
  active: boolean;
  scheduleStatus: string;
  timezone: string;
  baseAtLocal: string | null;
  startAt: Date | null;
  nextTriggerAt: Date | null;
  lastFiredAt: Date | null;
  lastAcknowledgedAt: Date | null;
  scheduleProvider: string | null;
  scheduleTargetId: string | null;
  scheduleTargetVersion: number | null;
  scheduleTargetFireAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

type ReminderUpdatePayload = Readonly<{
  title?: string | null;
  triggerAt?: number;
  nextTriggerAt?: number | null;
  updatedAt: number;
}>;

type ReminderCreateRequest = Readonly<{
  id: string;
  userId: string;
  title?: string | null;
  triggerAt: number;
  active: boolean;
  timezone: string;
  scheduleStatus?: string;
  updatedAt?: number;
  createdAt?: number;
}>;

type RemindersService = Readonly<{
  listReminders: (input: Readonly<{ userId: string; updatedSince?: number }>) => Promise<ReminderRecord[]>;
  getReminder: (input: Readonly<{ userId: string; reminderId: string }>) => Promise<ReminderRecord | null>;
  createReminder: (input: ReminderCreateRequest) => Promise<ReminderRecord>;
  updateReminder: (
    input: Readonly<{ userId: string; reminderId: string; patch: ReminderUpdatePayload }>,
  ) => Promise<ReminderRecord | null>;
  deleteReminder: (input: Readonly<{ userId: string; reminderId: string }>) => Promise<boolean>;
  ackReminder: (input: Readonly<{ userId: string; reminderId: string; ackType: 'done' | 'snooze' }>) => Promise<ReminderRecord | null>;
  snoozeReminder: (
    input: Readonly<{ userId: string; reminderId: string; snoozedUntil: number }>,
  ) => Promise<ReminderRecord | null>;
}>;

export const createReminder = (
  input: Readonly<{
    id: string;
    userId: string;
    updatedAt: number;
    title?: string | null;
    triggerAt?: number;
    nextTriggerAt?: number | null;
    snoozedUntil?: number | null;
    active?: boolean;
    scheduleStatus?: string;
    version?: number;
    scheduleProvider?: string | null;
    scheduleTargetId?: string | null;
    scheduleTargetVersion?: number | null;
    scheduleTargetFireAt?: Date | null;
  }>,
): ReminderRecord => {
  const triggerAt = new Date(input.triggerAt ?? input.updatedAt);
  const updatedAt = new Date(input.updatedAt);

  return {
    id: input.id,
    userId: input.userId,
    title: input.title ?? null,
    triggerAt,
    done: null,
    repeatRule: 'none',
    repeatConfig: null,
    repeat: null,
    snoozedUntil: input.snoozedUntil == null ? null : new Date(input.snoozedUntil),
    active: input.active ?? true,
    scheduleStatus: input.scheduleStatus ?? 'scheduled',
    timezone: 'UTC',
    baseAtLocal: null,
    startAt: null,
    nextTriggerAt:
      input.nextTriggerAt === undefined
        ? triggerAt
        : input.nextTriggerAt === null
          ? null
          : new Date(input.nextTriggerAt),
    lastFiredAt: null,
    lastAcknowledgedAt: null,
    scheduleProvider: input.scheduleProvider ?? null,
    scheduleTargetId: input.scheduleTargetId ?? null,
    scheduleTargetVersion: input.scheduleTargetVersion ?? null,
    scheduleTargetFireAt: input.scheduleTargetFireAt ?? null,
    version: input.version ?? 1,
    createdAt: updatedAt,
    updatedAt,
  };
};

export const createServiceDouble = (): RemindersService &
  Readonly<{ byKey: Map<string, ReminderRecord> }> => {
  const byKey = new Map<string, ReminderRecord>();
  const key = (userId: string, reminderId: string): string => `${userId}:${reminderId}`;

  return {
    byKey,
    listReminders: async ({ userId, updatedSince }) => {
      return [...byKey.values()].filter((item) => {
        if (item.userId !== userId) {
          return false;
        }

        if (updatedSince === undefined) {
          return true;
        }

        return item.updatedAt.getTime() > updatedSince;
      });
    },
    getReminder: async ({ userId, reminderId }) => {
      return byKey.get(key(userId, reminderId)) ?? null;
    },
    createReminder: async (input) => {
      const created = createReminder({
        id: input.id,
        userId: input.userId,
        updatedAt: input.updatedAt ?? Date.now(),
        title: input.title ?? null,
        triggerAt: input.triggerAt,
        nextTriggerAt: input.triggerAt,
        scheduleStatus: input.scheduleStatus ?? 'scheduled',
      });

      byKey.set(key(created.userId, created.id), created);
      return created;
    },
    updateReminder: async ({ userId, reminderId, patch }) => {
      const existing = byKey.get(key(userId, reminderId));
      if (!existing) {
        return null;
      }

      if (patch.updatedAt <= existing.updatedAt.getTime()) {
        return existing;
      }

      const next: ReminderRecord = {
        ...existing,
        ...(hasOwn(patch as Record<string, unknown>, 'title')
          ? { title: patch.title ?? null }
          : {}),
        ...(hasOwn(patch as Record<string, unknown>, 'triggerAt') && patch.triggerAt !== undefined
          ? { triggerAt: new Date(patch.triggerAt) }
          : {}),
        ...(hasOwn(patch as Record<string, unknown>, 'nextTriggerAt')
          ? {
              nextTriggerAt:
                patch.nextTriggerAt === null || patch.nextTriggerAt === undefined
                  ? null
                  : new Date(patch.nextTriggerAt),
            }
          : {}),
        updatedAt: new Date(patch.updatedAt),
        version: existing.version,
      };

      byKey.set(key(userId, reminderId), next);
      return next;
    },
    deleteReminder: async ({ userId, reminderId }) => {
      return byKey.delete(key(userId, reminderId));
    },
    ackReminder: async ({ userId, reminderId }) => {
      const existing = byKey.get(key(userId, reminderId));
      if (!existing) {
        return null;
      }

      const next: ReminderRecord = {
        ...existing,
        done: true,
        updatedAt: new Date(Date.now()),
      };
      byKey.set(key(userId, reminderId), next);
      return next;
    },
    snoozeReminder: async ({ userId, reminderId, snoozedUntil }) => {
      const existing = byKey.get(key(userId, reminderId));
      if (!existing) {
        return null;
      }

      const snoozeDate = new Date(snoozedUntil);
      const next: ReminderRecord = {
        ...existing,
        snoozedUntil: snoozeDate,
        nextTriggerAt: snoozeDate,
        updatedAt: new Date(Date.now()),
        version: existing.version + 1,
      };
      byKey.set(key(userId, reminderId), next);
      return next;
    },
  };
};

export const normalizeReminderPayload = (
  reminder: Record<string, unknown> | null,
): Record<string, unknown> | null => {
  if (reminder === null) {
    return null;
  }

  const toEpochMs = (value: unknown): number | null => {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'number') {
      return value;
    }

    if (value instanceof Date) {
      return value.getTime();
    }

    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? null : parsed;
    }

    return null;
  };

  return {
    ...reminder,
    triggerAt: toEpochMs(reminder.triggerAt),
    snoozedUntil: toEpochMs(reminder.snoozedUntil),
    createdAt: toEpochMs(reminder.createdAt),
    updatedAt: toEpochMs(reminder.updatedAt),
    nextTriggerAt: toEpochMs(reminder.nextTriggerAt),
    lastFiredAt: toEpochMs(reminder.lastFiredAt),
    lastAcknowledgedAt: toEpochMs(reminder.lastAcknowledgedAt),
  };
};

export const toPublicReminderPayload = (
  reminder: ReminderRecord,
): Record<string, unknown> => {
  const {
    scheduleProvider: _scheduleProvider,
    scheduleTargetId: _scheduleTargetId,
    scheduleTargetVersion: _scheduleTargetVersion,
    scheduleTargetFireAt: _scheduleTargetFireAt,
    ...publicReminder
  } = reminder;

  return publicReminder as Record<string, unknown>;
};

export const assertReminderContract = (reminder: Record<string, unknown>): void => {
  const normalized = normalizeReminderPayload(reminder);
  assert.notEqual(normalized, null);
  if (normalized === null) {
    throw new Error('Expected reminder payload');
  }

  assert.notEqual(normalized.version, undefined);
  assert.equal(
    normalized.nextTriggerAt === null || typeof normalized.nextTriggerAt === 'number',
    true,
  );
  assert.equal(hasOwn(normalized, 'scheduleProvider'), false);
  assert.equal(hasOwn(normalized, 'scheduleTargetId'), false);
  assert.equal(hasOwn(normalized, 'scheduleTargetVersion'), false);
  assert.equal(hasOwn(normalized, 'scheduleTargetFireAt'), false);
};
