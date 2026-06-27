import { createRequire } from "node:module";

import type { NoteChangeEventsRepository } from "@backend/notes/repositories/note-change-events-repository";
import type {
  ReminderCreateInput,
  ReminderPatchInput,
  ReminderRecord,
  ReminderRepeatRule,
} from "@backend/reminders/contracts";
import type { RemindersRepository } from "@backend/reminders/repositories/reminders-repository";
import { createRemindersService } from "@backend/reminders/service";

type ComputeNextTrigger = (
  now: number,
  startAt: number,
  baseAtLocal: string,
  repeat: ReminderRepeatRule | null,
  timezone?: string,
) => number | null;

const require = createRequire(import.meta.url);

const fallbackComputeNextTrigger: ComputeNextTrigger = (now, startAt, _baseAtLocal, repeat) => {
  if (!repeat) {
    return startAt > now ? startAt : null;
  }

  const toNextByStep = (stepMs: number): number | null => {
    if (!Number.isFinite(stepMs) || stepMs <= 0) {
      return null;
    }

    if (startAt > now) {
      return startAt;
    }

    const elapsed = now - startAt;
    const steps = Math.floor(elapsed / stepMs) + 1;
    return startAt + steps * stepMs;
  };

  if (repeat.kind === "daily") {
    return toNextByStep(repeat.interval * 24 * 60 * 60 * 1000);
  }

  if (repeat.kind === "weekly") {
    return toNextByStep(repeat.interval * 7 * 24 * 60 * 60 * 1000);
  }

  return null;
};

const loadComputeNextTrigger = (): ComputeNextTrigger => {
  try {
    const recurrenceModule = require("../../../../../packages/shared/utils/recurrence.js") as {
      computeNextTrigger?: ComputeNextTrigger;
    };
    if (typeof recurrenceModule.computeNextTrigger === "function") {
      return recurrenceModule.computeNextTrigger;
    }
  } catch {
    // Fall back when shared JS artifacts are unavailable in local/backend-only test runs.
  }

  return fallbackComputeNextTrigger;
};

export const computeNextTrigger = loadComputeNextTrigger();

const cloneReminder = (value: ReminderRecord): ReminderRecord => ({
  ...value,
  triggerAt: new Date(value.triggerAt.getTime()),
  repeatConfig: value.repeatConfig ? { ...value.repeatConfig } : null,
  repeat: value.repeat ? structuredClone(value.repeat) : null,
  snoozedUntil: value.snoozedUntil ? new Date(value.snoozedUntil.getTime()) : null,
  startAt: value.startAt ? new Date(value.startAt.getTime()) : null,
  nextTriggerAt: value.nextTriggerAt ? new Date(value.nextTriggerAt.getTime()) : null,
  lastFiredAt: value.lastFiredAt ? new Date(value.lastFiredAt.getTime()) : null,
  lastAcknowledgedAt: value.lastAcknowledgedAt
    ? new Date(value.lastAcknowledgedAt.getTime())
    : null,
  scheduleTargetFireAt: value.scheduleTargetFireAt
    ? new Date(value.scheduleTargetFireAt.getTime())
    : null,
  createdAt: new Date(value.createdAt.getTime()),
  updatedAt: new Date(value.updatedAt.getTime()),
});

const applyPatch = (current: ReminderRecord, patch: ReminderPatchInput): ReminderRecord => ({
  ...current,
  repeatConfig: current.repeatConfig ? { ...current.repeatConfig } : null,
  repeat: current.repeat ? structuredClone(current.repeat) : null,
  ...(Object.hasOwn(patch, "title") ? { title: patch.title ?? null } : {}),
  ...(Object.hasOwn(patch, "triggerAt") ? { triggerAt: patch.triggerAt ?? current.triggerAt } : {}),
  ...(Object.hasOwn(patch, "done") ? { done: patch.done ?? null } : {}),
  ...(Object.hasOwn(patch, "repeatRule") ? { repeatRule: patch.repeatRule ?? null } : {}),
  ...(Object.hasOwn(patch, "repeatConfig") ? { repeatConfig: patch.repeatConfig ?? null } : {}),
  ...(Object.hasOwn(patch, "repeat") ? { repeat: patch.repeat ?? null } : {}),
  ...(Object.hasOwn(patch, "snoozedUntil") ? { snoozedUntil: patch.snoozedUntil ?? null } : {}),
  ...(Object.hasOwn(patch, "active") ? { active: patch.active ?? true } : {}),
  ...(Object.hasOwn(patch, "scheduleStatus")
    ? { scheduleStatus: patch.scheduleStatus ?? "unscheduled" }
    : {}),
  ...(Object.hasOwn(patch, "timezone") ? { timezone: patch.timezone ?? "UTC" } : {}),
  ...(Object.hasOwn(patch, "baseAtLocal") ? { baseAtLocal: patch.baseAtLocal ?? null } : {}),
  ...(Object.hasOwn(patch, "startAt") ? { startAt: patch.startAt ?? null } : {}),
  ...(Object.hasOwn(patch, "nextTriggerAt") ? { nextTriggerAt: patch.nextTriggerAt ?? null } : {}),
  ...(Object.hasOwn(patch, "lastFiredAt") ? { lastFiredAt: patch.lastFiredAt ?? null } : {}),
  ...(Object.hasOwn(patch, "lastAcknowledgedAt")
    ? { lastAcknowledgedAt: patch.lastAcknowledgedAt ?? null }
    : {}),
  ...(Object.hasOwn(patch, "scheduleProvider")
    ? { scheduleProvider: patch.scheduleProvider ?? null }
    : {}),
  ...(Object.hasOwn(patch, "scheduleTargetId")
    ? { scheduleTargetId: patch.scheduleTargetId ?? null }
    : {}),
  ...(Object.hasOwn(patch, "scheduleTargetVersion")
    ? { scheduleTargetVersion: patch.scheduleTargetVersion ?? null }
    : {}),
  ...(Object.hasOwn(patch, "scheduleTargetFireAt")
    ? { scheduleTargetFireAt: patch.scheduleTargetFireAt ?? null }
    : {}),
  ...(Object.hasOwn(patch, "version") ? { version: patch.version ?? 1 } : {}),
  ...(Object.hasOwn(patch, "updatedAt") ? { updatedAt: patch.updatedAt ?? current.updatedAt } : {}),
});

export type Phase4RemindersParityHarness = Readonly<{
  remindersService: ReturnType<typeof createRemindersService>;
  setNow: (nextMs: number) => void;
  getEventAppendCount: () => number;
  getReminderHookCount: () => number;
}>;

/**
 * In-memory reminders repository + real RemindersService for phase-4 HTTP contract parity.
 * Mirrors backend phase4.http.contract.test.ts createReminderHarness().
 */
export const createPhase4RemindersParityHarness = (): Phase4RemindersParityHarness => {
  const byKey = new Map<string, ReminderRecord>();
  const duplicateKeys = new Set<string>();

  let nowMs = 1_760_000_000_000;
  let eventAppendCount = 0;
  let reminderHookCount = 0;

  const key = (userId: string, reminderId: string): string => `${userId}:${reminderId}`;

  const remindersRepository: RemindersRepository = {
    listByUser: async ({ userId, updatedSince }) => {
      return [...byKey.values()]
        .filter((item) => {
          if (item.userId !== userId) {
            return false;
          }

          if (!updatedSince) {
            return true;
          }

          return item.updatedAt.getTime() > updatedSince.getTime();
        })
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
        .map(cloneReminder);
    },
    listRepairCandidates: async ({ now, limit }) => {
      return [...byKey.values()]
        .filter((item) => {
          if (!item.active || item.nextTriggerAt === null) {
            return false;
          }

          return (
            item.nextTriggerAt.getTime() <= now.getTime() ||
            item.scheduleTargetId === null ||
            item.scheduleTargetVersion !== item.version
          );
        })
        .sort((left, right) => {
          const nextAtDelta =
            (left.nextTriggerAt?.getTime() ?? Number.POSITIVE_INFINITY) -
            (right.nextTriggerAt?.getTime() ?? Number.POSITIVE_INFINITY);
          if (nextAtDelta !== 0) {
            return nextAtDelta;
          }

          return left.updatedAt.getTime() - right.updatedAt.getTime();
        })
        .slice(0, limit)
        .map(cloneReminder);
    },
    findById: async ({ reminderId }) => {
      for (const record of byKey.values()) {
        if (record.id === reminderId) {
          return cloneReminder(record);
        }
      }

      return null;
    },
    findByIdForUser: async ({ reminderId, userId }) => {
      const found = byKey.get(key(userId, reminderId));
      return found ? cloneReminder(found) : null;
    },
    create: async (input: ReminderCreateInput) => {
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
        scheduleProvider: input.scheduleProvider,
        scheduleTargetId: input.scheduleTargetId,
        scheduleTargetVersion: input.scheduleTargetVersion,
        scheduleTargetFireAt: input.scheduleTargetFireAt,
        version: input.version,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      };

      byKey.set(key(created.userId, created.id), cloneReminder(created));
      return cloneReminder(created);
    },
    patch: async ({ reminderId, userId, patch }) => {
      const current = byKey.get(key(userId, reminderId));
      if (!current) {
        return null;
      }

      const next = applyPatch(cloneReminder(current), patch);
      byKey.set(key(userId, reminderId), cloneReminder(next));
      return cloneReminder(next);
    },
    advanceAfterDelivery: async ({
      reminderId,
      userId,
      occurrenceAt,
      expectedVersion,
      nextTriggerAt,
      scheduleStatus,
      runNow,
    }) => {
      const current = byKey.get(key(userId, reminderId));
      if (!current) {
        return null;
      }

      const currentOccurrence = current.snoozedUntil ?? current.nextTriggerAt ?? current.triggerAt;
      if (
        current.version !== expectedVersion ||
        !current.active ||
        currentOccurrence.getTime() !== occurrenceAt.getTime()
      ) {
        return null;
      }

      const next: ReminderRecord = {
        ...current,
        lastFiredAt: occurrenceAt,
        nextTriggerAt,
        scheduleStatus,
        scheduleProvider: null,
        scheduleTargetId: null,
        scheduleTargetVersion: null,
        scheduleTargetFireAt: null,
        updatedAt: current.updatedAt.getTime() > runNow.getTime() ? current.updatedAt : runNow,
        snoozedUntil: null,
      };

      byKey.set(key(userId, reminderId), cloneReminder(next));
      return cloneReminder(next);
    },
    deleteByIdForUser: async ({ reminderId, userId }) => {
      return byKey.delete(key(userId, reminderId));
    },
  };

  const noteChangeEventsRepository: NoteChangeEventsRepository = {
    isDuplicate: async (input) => {
      const dedupeKey = `${input.userId}:${input.noteId}:${input.operation}:${input.payloadHash}`;
      return duplicateKeys.has(dedupeKey);
    },
    appendEvent: async (input) => {
      const dedupeKey = `${input.userId}:${input.noteId}:${input.operation}:${input.payloadHash}`;
      duplicateKeys.add(dedupeKey);
      eventAppendCount += 1;
    },
  };

  const remindersService = createRemindersService({
    remindersRepository,
    noteChangeEventsRepository,
    now: () => new Date(nowMs),
    computeNext: computeNextTrigger,
    onReminderChanged: async () => {
      reminderHookCount += 1;
    },
  });

  return {
    remindersService,
    setNow: (nextMs: number) => {
      nowMs = nextMs;
    },
    getEventAppendCount: () => eventAppendCount,
    getReminderHookCount: () => reminderHookCount,
  };
};