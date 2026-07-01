import type { NoteChangeEventsRepository } from "@backend/notes/repositories/note-change-events-repository";
import type {
  ReminderCreateInput,
  ReminderPatchInput,
  ReminderRecord,
  ReminderRepeatRule,
  ReminderSchedulerPayload,
} from "@backend/reminders/contracts";
import { createReminderRepairJob } from "@backend/reminders/repair-job";
import type {
  ReminderDeliveriesRepository,
  ReminderDeliveryRecord,
} from "@backend/reminders/repositories/reminder-deliveries-repository";
import type { RemindersRepository } from "@backend/reminders/repositories/reminders-repository";
import type { SchedulerProvider } from "@backend/reminders/scheduler-provider";
import {
  createReminderDeliveryKey,
  createReminderSchedulerService,
} from "@backend/reminders/scheduler-service";

import {
  createApiNextRemindersService,
  createApiNextScheduledTaskExecutor,
} from "../../src/server/reminder-scheduling";

export const SCHEDULER_INTEGRATION_USER_ID = "user-1";

type EventLog = string[];

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

export const createReminderRecord = (
  input: Readonly<{
    id: string;
    userId: string;
    triggerAt: Date;
    updatedAt: Date;
    createdAt?: Date;
    title?: string | null;
    repeat?: ReminderRepeatRule | null;
    startAt?: Date | null;
    baseAtLocal?: string | null;
    nextTriggerAt?: Date | null;
    snoozedUntil?: Date | null;
    active?: boolean;
    done?: boolean | null;
    scheduleStatus?: string;
    version?: number;
    scheduleProvider?: string | null;
    scheduleTargetId?: string | null;
    scheduleTargetVersion?: number | null;
    scheduleTargetFireAt?: Date | null;
    lastFiredAt?: Date | null;
    lastAcknowledgedAt?: Date | null;
  }>,
): ReminderRecord => ({
  id: input.id,
  userId: input.userId,
  title: input.title ?? null,
  triggerAt: input.triggerAt,
  done: input.done ?? null,
  repeatRule: input.repeat?.kind ?? "none",
  repeatConfig: null,
  repeat: input.repeat ?? null,
  snoozedUntil: input.snoozedUntil ?? null,
  active: input.active ?? true,
  scheduleStatus: input.scheduleStatus ?? "scheduled",
  timezone: "UTC",
  baseAtLocal: input.baseAtLocal ?? null,
  startAt: input.startAt ?? null,
  nextTriggerAt: input.nextTriggerAt ?? null,
  lastFiredAt: input.lastFiredAt ?? null,
  lastAcknowledgedAt: input.lastAcknowledgedAt ?? null,
  scheduleProvider: input.scheduleProvider ?? null,
  scheduleTargetId: input.scheduleTargetId ?? null,
  scheduleTargetVersion: input.scheduleTargetVersion ?? null,
  scheduleTargetFireAt: input.scheduleTargetFireAt ?? null,
  version: input.version ?? 1,
  createdAt: input.createdAt ?? input.updatedAt,
  updatedAt: input.updatedAt,
});

const createChangeEventsRepository = (): NoteChangeEventsRepository => {
  const dedupe = new Set<string>();

  return {
    isDuplicate: async ({ noteId, userId, operation, payloadHash }) => {
      return dedupe.has(`${userId}:${noteId}:${operation}:${payloadHash}`);
    },
    appendEvent: async ({ noteId, userId, operation, payloadHash }) => {
      dedupe.add(`${userId}:${noteId}:${operation}:${payloadHash}`);
    },
  };
};

export type SchedulerHarness = Readonly<{
  events: EventLog;
  remindersRepository: RemindersRepository;
  reminderService: ReturnType<typeof createApiNextRemindersService>;
  scheduledTaskExecutor: ReturnType<typeof createApiNextScheduledTaskExecutor>;
  repairJob: ReturnType<typeof createReminderRepairJob>;
  deliveries: Map<string, ReminderDeliveryRecord>;
  getReminder: (userId: string, reminderId: string) => Promise<ReminderRecord | null>;
  getScheduledPayloadById: (scheduleId: string) => ReminderSchedulerPayload | null;
  getOnlyScheduledPayload: () => Readonly<{ scheduleId: string; payload: ReminderSchedulerPayload }>;
  insertReminder: (reminder: ReminderRecord) => void;
  resetEvents: () => void;
  setNow: (next: Date) => void;
  countScheduleEvents: () => number;
  countSendEvents: () => number;
}>;

export const createSchedulerHarness = (initialNow: Date): SchedulerHarness => {
  const events: EventLog = [];
  const remindersByKey = new Map<string, ReminderRecord>();
  const deliveries = new Map<string, ReminderDeliveryRecord>();
  const scheduledPayloads = new Map<string, ReminderSchedulerPayload>();
  let deliveryId = 0;
  let now = new Date(initialNow.getTime());

  const reminderKey = (userId: string, reminderId: string): string => `${userId}:${reminderId}`;
  const occurrenceKey = (reminderId: string, occurrenceAt: Date): string =>
    `${reminderId}:${occurrenceAt.getTime()}`;

  const applyPatch = (current: ReminderRecord, patch: ReminderPatchInput): ReminderRecord => ({
    ...current,
    ...(Object.hasOwn(patch, "title") ? { title: patch.title ?? null } : {}),
    ...(Object.hasOwn(patch, "triggerAt") ? { triggerAt: patch.triggerAt ?? current.triggerAt } : {}),
    ...(Object.hasOwn(patch, "done") ? { done: patch.done ?? null } : {}),
    ...(Object.hasOwn(patch, "repeatRule") ? { repeatRule: patch.repeatRule ?? null } : {}),
    ...(Object.hasOwn(patch, "repeatConfig") ? { repeatConfig: patch.repeatConfig ?? null } : {}),
    ...(Object.hasOwn(patch, "repeat") ? { repeat: patch.repeat ?? null } : {}),
    ...(Object.hasOwn(patch, "snoozedUntil") ? { snoozedUntil: patch.snoozedUntil ?? null } : {}),
    ...(Object.hasOwn(patch, "active") ? { active: patch.active ?? current.active } : {}),
    ...(Object.hasOwn(patch, "scheduleStatus")
      ? { scheduleStatus: patch.scheduleStatus ?? current.scheduleStatus }
      : {}),
    ...(Object.hasOwn(patch, "timezone") ? { timezone: patch.timezone ?? current.timezone } : {}),
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
    ...(Object.hasOwn(patch, "version") ? { version: patch.version ?? current.version } : {}),
    ...(Object.hasOwn(patch, "updatedAt") ? { updatedAt: patch.updatedAt ?? current.updatedAt } : {}),
  });

  const remindersRepository: RemindersRepository = {
    listByUser: async ({ userId, updatedSince }) => {
      return [...remindersByKey.values()]
        .filter((item) => {
          if (item.userId !== userId) {
            return false;
          }

          if (!updatedSince) {
            return true;
          }

          return item.updatedAt.getTime() > updatedSince.getTime();
        })
        .map(cloneReminder);
    },
    listRepairCandidates: async ({ now: runAt, limit }) => {
      return [...remindersByKey.values()]
        .filter((item) => {
          if (!item.active || item.nextTriggerAt === null) {
            return false;
          }

          return (
            item.nextTriggerAt.getTime() <= runAt.getTime() ||
            item.scheduleTargetId === null ||
            item.scheduleTargetVersion !== item.version
          );
        })
        .sort((left, right) => {
          const nextDelta =
            (left.nextTriggerAt?.getTime() ?? Number.POSITIVE_INFINITY) -
            (right.nextTriggerAt?.getTime() ?? Number.POSITIVE_INFINITY);
          if (nextDelta !== 0) {
            return nextDelta;
          }

          return left.updatedAt.getTime() - right.updatedAt.getTime();
        })
        .slice(0, limit)
        .map(cloneReminder);
    },
    findById: async ({ reminderId }) => {
      for (const record of remindersByKey.values()) {
        if (record.id === reminderId) {
          return cloneReminder(record);
        }
      }

      return null;
    },
    findByIdForUser: async ({ reminderId, userId }) => {
      const found = remindersByKey.get(reminderKey(userId, reminderId));
      return found ? cloneReminder(found) : null;
    },
    create: async (input: ReminderCreateInput) => {
      const created = cloneReminder({
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
      });

      remindersByKey.set(reminderKey(created.userId, created.id), cloneReminder(created));
      return cloneReminder(created);
    },
    patch: async ({ reminderId, userId, patch }) => {
      const current = remindersByKey.get(reminderKey(userId, reminderId));
      if (!current) {
        return null;
      }

      const next = cloneReminder(applyPatch(cloneReminder(current), patch));
      remindersByKey.set(reminderKey(userId, reminderId), cloneReminder(next));
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
      const current = remindersByKey.get(reminderKey(userId, reminderId));
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

      const next = cloneReminder({
        ...current,
        lastFiredAt: occurrenceAt,
        nextTriggerAt,
        scheduleStatus,
        scheduleProvider: null,
        scheduleTargetId: null,
        scheduleTargetVersion: null,
        scheduleTargetFireAt: null,
        snoozedUntil: null,
        updatedAt: runNow,
      });

      remindersByKey.set(reminderKey(userId, reminderId), cloneReminder(next));
      return cloneReminder(next);
    },
    deleteByIdForUser: async ({ reminderId, userId }) => {
      return remindersByKey.delete(reminderKey(userId, reminderId));
    },
  };

  const deliveriesRepository: ReminderDeliveriesRepository = {
    insertPending: async ({ reminderId, userId, occurrenceAt, reminderVersion, deliveryKey }) => {
      const byOccurrence = occurrenceKey(reminderId, occurrenceAt);
      const existing = deliveries.get(byOccurrence) ?? deliveries.get(deliveryKey);
      if (existing) {
        return { inserted: false, delivery: existing };
      }

      const created: ReminderDeliveryRecord = {
        id: `delivery-${++deliveryId}`,
        reminderId,
        userId,
        occurrenceAt,
        reminderVersion,
        deliveryKey,
        status: "pending",
        providerMessageId: null,
        attemptCount: 0,
        createdAt: new Date(now.getTime()),
        sentAt: null,
        failureReason: null,
      };

      deliveries.set(byOccurrence, created);
      deliveries.set(deliveryKey, created);
      events.push(`delivery:${deliveryKey}`);
      return { inserted: true, delivery: created };
    },
    markSent: async ({ deliveryKey, providerMessageId }) => {
      const existing = deliveries.get(deliveryKey);
      if (!existing) {
        throw new Error(`Missing delivery ${deliveryKey}`);
      }

      const next: ReminderDeliveryRecord = {
        ...existing,
        status: "sent",
        providerMessageId: providerMessageId ?? null,
        attemptCount: existing.attemptCount + 1,
        sentAt: new Date(now.getTime()),
        failureReason: null,
      };
      deliveries.set(deliveryKey, next);
      deliveries.set(occurrenceKey(next.reminderId, next.occurrenceAt), next);
    },
    markFailed: async ({ deliveryKey, reason }) => {
      const existing = deliveries.get(deliveryKey);
      if (!existing) {
        throw new Error(`Missing delivery ${deliveryKey}`);
      }

      const next: ReminderDeliveryRecord = {
        ...existing,
        status: "failed",
        attemptCount: existing.attemptCount + 1,
        failureReason: reason,
      };
      deliveries.set(deliveryKey, next);
      deliveries.set(occurrenceKey(next.reminderId, next.occurrenceAt), next);
    },
    markCanceled: async ({ deliveryKey, reminderId, userId, occurrenceAt, reminderVersion, reason }) => {
      const next: ReminderDeliveryRecord = {
        id: `delivery-${++deliveryId}`,
        reminderId,
        userId,
        occurrenceAt,
        reminderVersion,
        deliveryKey,
        status: "canceled",
        providerMessageId: null,
        attemptCount: 0,
        createdAt: new Date(now.getTime()),
        sentAt: null,
        failureReason: reason,
      };
      deliveries.set(deliveryKey, next);
      deliveries.set(occurrenceKey(reminderId, occurrenceAt), next);
    },
    markStale: async ({ deliveryKey, reminderId, userId, occurrenceAt, reminderVersion, reason }) => {
      const next: ReminderDeliveryRecord = {
        id: `delivery-${++deliveryId}`,
        reminderId,
        userId,
        occurrenceAt,
        reminderVersion,
        deliveryKey,
        status: "stale",
        providerMessageId: null,
        attemptCount: 0,
        createdAt: new Date(now.getTime()),
        sentAt: null,
        failureReason: reason,
      };
      deliveries.set(deliveryKey, next);
      deliveries.set(occurrenceKey(reminderId, occurrenceAt), next);
    },
  };

  const provider: SchedulerProvider = {
    name: "fake",
    scheduleOnce: async (payload) => {
      const scheduleId = `schedule-${payload.deliveryKey}`;
      scheduledPayloads.set(scheduleId, {
        reminderId: payload.reminderId,
        occurrenceAt: payload.occurrenceAt.toISOString(),
        version: payload.version,
        deliveryKey: payload.deliveryKey,
      });
      events.push(`schedule:${payload.reminderId}:${payload.version}`);
      return {
        provider: "fake",
        scheduleId,
        fireAt: payload.occurrenceAt,
      };
    },
    cancel: async ({ scheduleId }) => {
      scheduledPayloads.delete(scheduleId);
      events.push(`cancel:${scheduleId}`);
    },
  };

  const schedulerService = createReminderSchedulerService({
    provider,
    remindersRepository,
    now: () => new Date(now.getTime()),
  });

  const scheduledTaskExecutor = createApiNextScheduledTaskExecutor({
    remindersRepository,
    deliveriesRepository,
    notificationSender: {
      sendReminderNotification: async ({ reminder }) => {
        events.push(`send:${reminder.id}`);
        return {
          status: "sent",
          delivered: 1,
          failed: 0,
          providerMessageId: `push:${reminder.id}`,
        };
      },
    },
    schedulerService,
    now: () => new Date(now.getTime()),
  });

  const repairJob = createReminderRepairJob({
    remindersRepository,
    executor: scheduledTaskExecutor,
    schedulerService,
    now: () => new Date(now.getTime()),
  });

  const reminderService = createApiNextRemindersService({
    remindersRepository,
    noteChangeEventsRepository: createChangeEventsRepository(),
    schedulerService,
    now: () => new Date(now.getTime()),
  });

  return {
    events,
    remindersRepository,
    reminderService,
    scheduledTaskExecutor,
    repairJob,
    deliveries,
    getReminder: async (userId, reminderId) => {
      return await remindersRepository.findByIdForUser({ userId, reminderId });
    },
    getScheduledPayloadById: (scheduleId) => {
      return scheduledPayloads.get(scheduleId) ?? null;
    },
    getOnlyScheduledPayload: () => {
      const first = [...scheduledPayloads.entries()][0];
      if (!first) {
        throw new Error("Expected one scheduled payload");
      }

      if (scheduledPayloads.size !== 1) {
        throw new Error(`Expected one scheduled payload, found ${scheduledPayloads.size}`);
      }

      return { scheduleId: first[0], payload: first[1] };
    },
    insertReminder: (reminder) => {
      remindersByKey.set(reminderKey(reminder.userId, reminder.id), cloneReminder(reminder));
    },
    resetEvents: () => {
      events.splice(0, events.length);
    },
    setNow: (next) => {
      now = new Date(next.getTime());
    },
    countScheduleEvents: () => events.filter((event) => event.startsWith("schedule:")).length,
    countSendEvents: () => events.filter((event) => event.startsWith("send:")).length,
  };
};

export { createReminderDeliveryKey };
