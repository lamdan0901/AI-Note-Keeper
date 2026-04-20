import { createRequire } from 'node:module';

import { sha256 } from 'js-sha256';

import { AppError } from '../middleware/error-middleware.js';
import type { NoteChangeEventsRepository } from '../notes/repositories/note-change-events-repository.js';
import {
  assertValidRepeatRule,
  assertValidTimezone,
  hasOwnField,
  toReminderPatch,
  type ReminderCreateInput,
  type ReminderPatchInput,
  type ReminderRecord,
  type ReminderRepeatRule,
  type ReminderUpdatePayload,
} from './contracts.js';
import type { RemindersRepository } from './repositories/reminders-repository.js';

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

  if (repeat.kind === 'daily') {
    return toNextByStep(repeat.interval * 24 * 60 * 60 * 1000);
  }

  if (repeat.kind === 'weekly') {
    return toNextByStep(repeat.interval * 7 * 24 * 60 * 60 * 1000);
  }

  if (repeat.kind === 'monthly') {
    const anchor = new Date(startAt);
    if (startAt > now) {
      return anchor.getTime();
    }

    while (anchor.getTime() <= now) {
      anchor.setUTCMonth(anchor.getUTCMonth() + repeat.interval);
    }

    return anchor.getTime();
  }

  if (repeat.kind === 'custom') {
    if (repeat.frequency === 'minutes') {
      return toNextByStep(repeat.interval * 60 * 1000);
    }

    if (repeat.frequency === 'days') {
      return toNextByStep(repeat.interval * 24 * 60 * 60 * 1000);
    }

    if (repeat.frequency === 'weeks') {
      return toNextByStep(repeat.interval * 7 * 24 * 60 * 60 * 1000);
    }

    if (repeat.frequency === 'months') {
      const anchor = new Date(startAt);
      if (startAt > now) {
        return anchor.getTime();
      }

      while (anchor.getTime() <= now) {
        anchor.setUTCMonth(anchor.getUTCMonth() + repeat.interval);
      }

      return anchor.getTime();
    }
  }

  return null;
};

const loadComputeNextTrigger = (): ComputeNextTrigger => {
  try {
    const shared = require('../../../../packages/shared/utils/recurrence.js') as {
      computeNextTrigger?: ComputeNextTrigger;
    };

    if (typeof shared.computeNextTrigger === 'function') {
      return shared.computeNextTrigger;
    }
  } catch {
    // Fall through to parity-safe local fallback when shared JS artifacts are unavailable.
  }

  return fallbackComputeNextTrigger;
};

const computeNextTrigger = loadComputeNextTrigger();

export type ReminderCreateRequest = Readonly<{
  userId: string;
  id: string;
  title?: string | null;
  triggerAt: number;
  repeatRule?: string;
  repeatConfig?: Record<string, unknown> | null;
  repeat?: ReminderRepeatRule | null;
  snoozedUntil?: number | null;
  active: boolean;
  scheduleStatus?: string;
  timezone: string;
  baseAtLocal?: string | null;
  startAt?: number | null;
  updatedAt?: number;
  createdAt?: number;
  deviceId?: string;
}>;

export type ReminderUpdateRequest = Readonly<{
  userId: string;
  reminderId: string;
  patch: ReminderUpdatePayload;
  deviceId?: string;
}>;

export type ReminderAckRequest = Readonly<{
  userId: string;
  reminderId: string;
  ackType: 'done' | 'snooze';
  deviceId?: string;
}>;

export type ReminderSnoozeRequest = Readonly<{
  userId: string;
  reminderId: string;
  snoozedUntil: number;
  deviceId?: string;
}>;

export type ReminderChangedPayload = Readonly<{
  reminder: ReminderRecord;
  operation: 'create' | 'update' | 'delete';
}>;

type RemindersServiceDeps = Readonly<{
  remindersRepository?: RemindersRepository;
  noteChangeEventsRepository?: NoteChangeEventsRepository;
  now?: () => Date;
  computeNext?: ComputeNextTrigger;
  onReminderChanged?: (input: ReminderChangedPayload) => Promise<void> | void;
}>;

export type RemindersService = Readonly<{
  listReminders: (
    input: Readonly<{ userId: string; updatedSince?: number }>,
  ) => Promise<ReminderRecord[]>;
  getReminder: (
    input: Readonly<{ userId: string; reminderId: string }>,
  ) => Promise<ReminderRecord | null>;
  createReminder: (input: ReminderCreateRequest) => Promise<ReminderRecord>;
  updateReminder: (input: ReminderUpdateRequest) => Promise<ReminderRecord | null>;
  deleteReminder: (
    input: Readonly<{ userId: string; reminderId: string; deviceId?: string }>,
  ) => Promise<boolean>;
  ackReminder: (input: ReminderAckRequest) => Promise<ReminderRecord | null>;
  snoozeReminder: (input: ReminderSnoozeRequest) => Promise<ReminderRecord | null>;
}>;

const isDateEqual = (left: Date | null | undefined, right: Date | null | undefined): boolean => {
  if (left === undefined && right === undefined) {
    return true;
  }

  if (left === null || right === null) {
    return left === right;
  }

  if (left === undefined || right === undefined) {
    return false;
  }

  return left.getTime() === right.getTime();
};

const isObjectEqual = (
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null,
): boolean => {
  if (left === null || right === null) {
    return left === right;
  }

  return JSON.stringify(left) === JSON.stringify(right);
};

const normalizeReminderForHash = (reminder: ReminderRecord): Record<string, unknown> => {
  return {
    id: reminder.id,
    userId: reminder.userId,
    title: reminder.title,
    triggerAt: reminder.triggerAt.getTime(),
    done: reminder.done,
    repeatRule: reminder.repeatRule,
    repeatConfig: reminder.repeatConfig,
    repeat: reminder.repeat,
    snoozedUntil: reminder.snoozedUntil?.getTime() ?? null,
    active: reminder.active,
    scheduleStatus: reminder.scheduleStatus,
    timezone: reminder.timezone,
    baseAtLocal: reminder.baseAtLocal,
    startAt: reminder.startAt?.getTime() ?? null,
    nextTriggerAt: reminder.nextTriggerAt?.getTime() ?? null,
    lastFiredAt: reminder.lastFiredAt?.getTime() ?? null,
    lastAcknowledgedAt: reminder.lastAcknowledgedAt?.getTime() ?? null,
    version: reminder.version,
    updatedAt: reminder.updatedAt.getTime(),
    createdAt: reminder.createdAt.getTime(),
  };
};

const calculatePayloadHash = (reminder: ReminderRecord): string => {
  return sha256(JSON.stringify(normalizeReminderForHash(reminder)));
};

const hasEffectivePatch = (existing: ReminderRecord, patch: ReminderPatchInput): boolean => {
  const source = patch as Record<string, unknown>;

  if (hasOwnField(source, 'title') && patch.title !== existing.title) return true;
  if (hasOwnField(source, 'triggerAt') && !isDateEqual(patch.triggerAt, existing.triggerAt))
    return true;
  if (hasOwnField(source, 'done') && patch.done !== existing.done) return true;
  if (hasOwnField(source, 'repeatRule') && patch.repeatRule !== existing.repeatRule) return true;
  if (
    hasOwnField(source, 'repeatConfig') &&
    !isObjectEqual(patch.repeatConfig ?? null, existing.repeatConfig)
  )
    return true;
  if (
    hasOwnField(source, 'repeat') &&
    JSON.stringify(patch.repeat ?? null) !== JSON.stringify(existing.repeat)
  )
    return true;
  if (
    hasOwnField(source, 'snoozedUntil') &&
    !isDateEqual(patch.snoozedUntil, existing.snoozedUntil)
  )
    return true;
  if (hasOwnField(source, 'active') && patch.active !== existing.active) return true;
  if (hasOwnField(source, 'scheduleStatus') && patch.scheduleStatus !== existing.scheduleStatus)
    return true;
  if (hasOwnField(source, 'timezone') && patch.timezone !== existing.timezone) return true;
  if (hasOwnField(source, 'baseAtLocal') && patch.baseAtLocal !== existing.baseAtLocal) return true;
  if (hasOwnField(source, 'startAt') && !isDateEqual(patch.startAt, existing.startAt)) return true;
  if (
    hasOwnField(source, 'nextTriggerAt') &&
    !isDateEqual(patch.nextTriggerAt, existing.nextTriggerAt)
  )
    return true;
  if (hasOwnField(source, 'lastFiredAt') && !isDateEqual(patch.lastFiredAt, existing.lastFiredAt))
    return true;
  if (
    hasOwnField(source, 'lastAcknowledgedAt') &&
    !isDateEqual(patch.lastAcknowledgedAt, existing.lastAcknowledgedAt)
  ) {
    return true;
  }

  return false;
};

const computeRecurrenceNextTrigger = (
  nextCompute: ComputeNextTrigger,
  input: Readonly<{
    repeat: ReminderRepeatRule | null;
    startAt: Date | null;
    baseAtLocal: string | null;
    timezone: string;
    nowMs: number;
  }>,
): Date | null => {
  if (!input.repeat || !input.startAt || !input.baseAtLocal) {
    return null;
  }

  const next = nextCompute(
    input.nowMs,
    input.startAt.getTime(),
    input.baseAtLocal,
    input.repeat,
    input.timezone,
  );

  return next === null ? null : new Date(next);
};

export const createRemindersService = (deps: RemindersServiceDeps = {}): RemindersService => {
  const remindersRepository =
    deps.remindersRepository ??
    (() => {
      const mod = require('./repositories/reminders-repository.js') as {
        createRemindersRepository: () => RemindersRepository;
      };
      return mod.createRemindersRepository();
    })();
  const noteChangeEventsRepository =
    deps.noteChangeEventsRepository ??
    (() => {
      const mod = require('../notes/repositories/note-change-events-repository.js') as {
        createNoteChangeEventsRepository: () => NoteChangeEventsRepository;
      };
      return mod.createNoteChangeEventsRepository();
    })();
  const now = deps.now ?? (() => new Date());
  const nextCompute = deps.computeNext ?? computeNextTrigger;
  const onReminderChanged = deps.onReminderChanged ?? (() => undefined);

  const emitChangeEvent = async (
    reminder: ReminderRecord,
    operation: 'create' | 'update' | 'delete',
    deviceId: string,
  ): Promise<void> => {
    const payloadHash = calculatePayloadHash(reminder);
    const dedupeInput = {
      noteId: reminder.id,
      userId: reminder.userId,
      operation,
      payloadHash,
    } as const;

    const duplicate = await noteChangeEventsRepository.isDuplicate(dedupeInput);
    if (duplicate) {
      return;
    }

    await noteChangeEventsRepository.appendEvent({
      ...dedupeInput,
      deviceId,
      changedAt: now(),
    });

    await onReminderChanged({ reminder, operation });
  };

  return {
    listReminders: async ({ userId, updatedSince }) => {
      return await remindersRepository.listByUser({
        userId,
        updatedSince: updatedSince === undefined ? undefined : new Date(updatedSince),
      });
    },

    getReminder: async ({ userId, reminderId }) => {
      return await remindersRepository.findByIdForUser({ reminderId, userId });
    },

    createReminder: async (input) => {
      if (input.userId.trim().length === 0) {
        throw new AppError({
          code: 'forbidden',
          message: 'User is required for reminder creation',
        });
      }

      assertValidTimezone(input.timezone);
      assertValidRepeatRule(input.repeat ?? null);

      const nowDate = now();
      const startAt =
        input.startAt === null || input.startAt === undefined ? null : new Date(input.startAt);
      const baseAtLocal = input.baseAtLocal ?? null;
      const repeat = input.repeat ?? null;
      const triggerAt = new Date(input.triggerAt);
      const computedNextTrigger = computeRecurrenceNextTrigger(nextCompute, {
        repeat,
        startAt,
        baseAtLocal,
        timezone: input.timezone,
        nowMs: nowDate.getTime(),
      });

      const createInput: ReminderCreateInput = {
        id: input.id,
        userId: input.userId,
        title: input.title ?? null,
        triggerAt,
        done: null,
        repeatRule: input.repeatRule ?? (repeat ? repeat.kind : 'none'),
        repeatConfig: input.repeatConfig ?? null,
        repeat,
        snoozedUntil:
          input.snoozedUntil === null || input.snoozedUntil === undefined
            ? null
            : new Date(input.snoozedUntil),
        active: input.active,
        scheduleStatus: input.scheduleStatus ?? 'unscheduled',
        timezone: input.timezone,
        baseAtLocal,
        startAt,
        nextTriggerAt: computedNextTrigger,
        lastFiredAt: null,
        lastAcknowledgedAt: null,
        version: 1,
        createdAt: input.createdAt === undefined ? nowDate : new Date(input.createdAt),
        updatedAt: input.updatedAt === undefined ? nowDate : new Date(input.updatedAt),
      };

      const created = await remindersRepository.create(createInput);
      await emitChangeEvent(created, 'create', input.deviceId ?? 'web');
      return created;
    },

    updateReminder: async ({ userId, reminderId, patch, deviceId }) => {
      const existing = await remindersRepository.findByIdForUser({ reminderId, userId });
      if (!existing) {
        return null;
      }

      if (patch.updatedAt <= existing.updatedAt.getTime()) {
        return existing;
      }

      const patchInput = toReminderPatch(patch);
      const source = patch as Record<string, unknown>;

      if (hasOwnField(source, 'timezone')) {
        assertValidTimezone(patch.timezone as string);
      }

      const recurrenceChanged =
        hasOwnField(source, 'repeat') ||
        hasOwnField(source, 'startAt') ||
        hasOwnField(source, 'baseAtLocal');

      if (recurrenceChanged) {
        const nextRepeat = hasOwnField(source, 'repeat')
          ? (patchInput.repeat ?? null)
          : existing.repeat;
        const nextStartAt = hasOwnField(source, 'startAt')
          ? (patchInput.startAt ?? null)
          : existing.startAt;
        const nextBaseAtLocal = hasOwnField(source, 'baseAtLocal')
          ? (patchInput.baseAtLocal ?? null)
          : existing.baseAtLocal;
        const nextTimezone = hasOwnField(source, 'timezone')
          ? (patchInput.timezone as string)
          : existing.timezone;

        patchInput.nextTriggerAt = computeRecurrenceNextTrigger(nextCompute, {
          repeat: nextRepeat,
          startAt: nextStartAt,
          baseAtLocal: nextBaseAtLocal,
          timezone: nextTimezone,
          nowMs: now().getTime(),
        });
      }

      if (!hasEffectivePatch(existing, patchInput)) {
        return existing;
      }

      patchInput.version = existing.version + 1;
      patchInput.updatedAt = new Date(patch.updatedAt);

      const updated = await remindersRepository.patch({
        reminderId,
        userId,
        patch: patchInput,
      });

      if (!updated) {
        return await remindersRepository.findByIdForUser({ reminderId, userId });
      }

      await emitChangeEvent(updated, 'update', deviceId ?? 'web');
      return updated;
    },

    deleteReminder: async ({ userId, reminderId, deviceId }) => {
      const existing = await remindersRepository.findByIdForUser({ reminderId, userId });
      if (!existing) {
        return false;
      }

      const deleted = await remindersRepository.deleteByIdForUser({ reminderId, userId });
      if (!deleted) {
        return false;
      }

      await emitChangeEvent(existing, 'delete', deviceId ?? 'web');
      return true;
    },

    ackReminder: async ({ userId, reminderId, ackType, deviceId }) => {
      const existing = await remindersRepository.findByIdForUser({ reminderId, userId });
      if (!existing) {
        return null;
      }

      if (ackType !== 'done') {
        throw new AppError({
          code: 'validation',
          message: 'Only ackType=done is supported for reminders',
        });
      }

      const nowDate = now();
      const nowMs = nowDate.getTime();
      const patch: ReminderPatchInput = {
        done: true,
        updatedAt: nowDate,
        lastAcknowledgedAt: nowDate,
        version: existing.version + 1,
      };

      const hasRecurrence = Boolean(existing.repeat && existing.startAt && existing.baseAtLocal);
      if (hasRecurrence) {
        const next = computeRecurrenceNextTrigger(nextCompute, {
          repeat: existing.repeat,
          startAt: existing.startAt,
          baseAtLocal: existing.baseAtLocal,
          timezone: existing.timezone,
          nowMs,
        });

        if (next) {
          patch.nextTriggerAt = next;
          patch.scheduleStatus = 'scheduled';
          patch.lastFiredAt = nowDate;
        } else {
          patch.nextTriggerAt = null;
          patch.scheduleStatus = 'unscheduled';
        }

        patch.snoozedUntil = null;
      } else if (existing.snoozedUntil && existing.snoozedUntil.getTime() > nowMs) {
        patch.nextTriggerAt = existing.snoozedUntil;
        patch.scheduleStatus = 'scheduled';
      } else {
        patch.nextTriggerAt = null;
        patch.snoozedUntil = null;
        patch.scheduleStatus = 'unscheduled';
      }

      const updated = await remindersRepository.patch({
        reminderId,
        userId,
        patch,
      });

      if (!updated) {
        return await remindersRepository.findByIdForUser({ reminderId, userId });
      }

      await emitChangeEvent(updated, 'update', deviceId ?? 'web');
      return updated;
    },

    snoozeReminder: async ({ userId, reminderId, snoozedUntil, deviceId }) => {
      const existing = await remindersRepository.findByIdForUser({ reminderId, userId });
      if (!existing) {
        return null;
      }

      const patch: ReminderPatchInput = {
        snoozedUntil: new Date(snoozedUntil),
        nextTriggerAt: new Date(snoozedUntil),
        scheduleStatus: 'scheduled',
        active: true,
        updatedAt: now(),
        version: existing.version + 1,
      };

      if (!hasEffectivePatch(existing, patch)) {
        return existing;
      }

      const updated = await remindersRepository.patch({
        reminderId,
        userId,
        patch,
      });

      if (!updated) {
        return await remindersRepository.findByIdForUser({ reminderId, userId });
      }

      await emitChangeEvent(updated, 'update', deviceId ?? 'web');
      return updated;
    },
  };
};
