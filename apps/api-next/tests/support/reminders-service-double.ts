import type { ReminderRecord } from "@backend/reminders/contracts.js";
import type { RemindersService } from "@backend/reminders/service";

export const DEFAULT_REMINDERS_AUTH_USER_ID = "reminders-harness-user-1";

const createReminderRecord = (
  input: Readonly<{
    id: string;
    userId: string;
    updatedAt: number;
    title?: string | null;
  }>,
): ReminderRecord => {
  const updatedAt = new Date(input.updatedAt);

  return {
    id: input.id,
    userId: input.userId,
    title: input.title ?? "title",
    content: "secret-content",
    contentType: "text/plain",
    triggerAt: updatedAt,
    done: null,
    repeatRule: "none",
    repeatConfig: null,
    repeat: null,
    snoozedUntil: null,
    active: true,
    scheduleStatus: "scheduled",
    timezone: "UTC",
    baseAtLocal: null,
    startAt: null,
    nextTriggerAt: updatedAt,
    lastFiredAt: null,
    lastAcknowledgedAt: null,
    scheduleProvider: "qstash",
    scheduleTargetId: "target-1",
    scheduleTargetVersion: 3,
    scheduleTargetFireAt: new Date("2026-01-01T00:00:00.000Z"),
    version: 1,
    createdAt: updatedAt,
    updatedAt,
  };
};

export type ReminderCreateCall = Readonly<{
  id: string;
  userId: string;
  title?: string | null;
  triggerAt?: number;
  active?: boolean;
  timezone?: string;
}>;

export type RemindersServiceDouble = RemindersService &
  Readonly<{
    seed: (reminder: ReminderRecord) => void;
    listCalls: ReadonlyArray<Readonly<{ userId: string; updatedSince?: number }>>;
    createCalls: ReadonlyArray<ReminderCreateCall>;
  }>;

/**
 * Stateful in-memory RemindersService double for api-next route contract tests.
 */
export function createRemindersServiceDouble(
  defaultUserId: string = DEFAULT_REMINDERS_AUTH_USER_ID,
): RemindersServiceDouble {
  const byKey = new Map<string, ReminderRecord>();
  const listCalls: Array<Readonly<{ userId: string; updatedSince?: number }>> = [];
  const createCalls: Array<ReminderCreateCall> = [];

  const key = (userId: string, reminderId: string): string => `${userId}:${reminderId}`;

  return {
    listCalls,
    createCalls,
    seed: (reminder) => {
      byKey.set(key(reminder.userId, reminder.id), reminder);
    },
    listReminders: async ({ userId, updatedSince }) => {
      listCalls.push({ userId, updatedSince });
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
      createCalls.push({
        id: input.id,
        userId: input.userId,
        title: input.title,
        triggerAt: input.triggerAt,
        active: input.active,
        timezone: input.timezone,
      });
      const created = createReminderRecord({
        id: input.id,
        userId: input.userId ?? defaultUserId,
        updatedAt: input.updatedAt ?? Date.now(),
        title: input.title ?? null,
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
        ...(Object.hasOwn(patch as Record<string, unknown>, "title")
          ? { title: patch.title ?? null }
          : {}),
        updatedAt: new Date(patch.updatedAt),
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
        updatedAt: new Date(existing.updatedAt.getTime() + 1_000),
        lastAcknowledgedAt: new Date(existing.updatedAt.getTime() + 1_000),
        version: existing.version + 1,
      };

      byKey.set(key(userId, reminderId), next);
      return next;
    },
    snoozeReminder: async ({ userId, reminderId, snoozedUntil }) => {
      const existing = byKey.get(key(userId, reminderId));
      if (!existing) {
        return null;
      }

      const snoozedDate = new Date(snoozedUntil);
      const next: ReminderRecord = {
        ...existing,
        snoozedUntil: snoozedDate,
        nextTriggerAt: snoozedDate,
        scheduleStatus: "scheduled",
        active: true,
        updatedAt: new Date(existing.updatedAt.getTime() + 2_000),
        version: existing.version + 1,
      };

      byKey.set(key(userId, reminderId), next);
      return next;
    },
  };
}

/** Alias matching the backend contract-test naming (`createServiceDouble`). */
export { createRemindersServiceDouble as createServiceDouble };