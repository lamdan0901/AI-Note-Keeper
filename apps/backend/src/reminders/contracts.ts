import { z } from 'zod';

import { AppError } from '../middleware/error-middleware.js';

export type ReminderRepeatRule =
  | Readonly<{ kind: 'daily'; interval: number }>
  | Readonly<{ kind: 'weekly'; interval: number; weekdays: number[] }>
  | Readonly<{ kind: 'monthly'; interval: number; mode: 'day_of_month' }>
  | Readonly<{
      kind: 'custom';
      interval: number;
      frequency: 'minutes' | 'days' | 'weeks' | 'months';
    }>;

export const reminderRepeatSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('daily'),
    interval: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('weekly'),
    interval: z.number().int().positive(),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1),
  }),
  z.object({
    kind: z.literal('monthly'),
    interval: z.number().int().positive(),
    mode: z.literal('day_of_month'),
  }),
  z.object({
    kind: z.literal('custom'),
    interval: z.number().int().positive(),
    frequency: z.enum(['minutes', 'days', 'weeks', 'months']),
  }),
]);

const nullableDateInputSchema = z.number().int().nullable();

export const reminderCreateBodySchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1).optional(),
  title: z.string().nullable().optional(),
  triggerAt: z.number().int(),
  repeatRule: z.enum(['none', 'daily', 'weekly', 'monthly', 'custom']).optional(),
  repeatConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  repeat: reminderRepeatSchema.nullable().optional(),
  snoozedUntil: nullableDateInputSchema.optional(),
  active: z.boolean(),
  scheduleStatus: z.enum(['scheduled', 'unscheduled', 'error']).optional(),
  timezone: z.string().min(1),
  baseAtLocal: z.string().nullable().optional(),
  startAt: nullableDateInputSchema.optional(),
  updatedAt: z.number().int().optional(),
  createdAt: z.number().int().optional(),
  deviceId: z.string().min(1).optional(),
});

export const reminderUpdateBodySchema = z.object({
  userId: z.string().min(1).optional(),
  title: z.string().nullable().optional(),
  triggerAt: z.number().int().optional(),
  done: z.boolean().nullable().optional(),
  repeatRule: z.enum(['none', 'daily', 'weekly', 'monthly', 'custom']).nullable().optional(),
  repeatConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  repeat: reminderRepeatSchema.nullable().optional(),
  snoozedUntil: nullableDateInputSchema.optional(),
  active: z.boolean().optional(),
  scheduleStatus: z.enum(['scheduled', 'unscheduled', 'error']).nullable().optional(),
  timezone: z.string().nullable().optional(),
  baseAtLocal: z.string().nullable().optional(),
  startAt: nullableDateInputSchema.optional(),
  nextTriggerAt: nullableDateInputSchema.optional(),
  lastFiredAt: nullableDateInputSchema.optional(),
  lastAcknowledgedAt: nullableDateInputSchema.optional(),
  updatedAt: z.number().int(),
  deviceId: z.string().min(1).optional(),
});

export const reminderAckBodySchema = z.object({
  ackType: z.enum(['done', 'snooze']),
  optimisticNextTrigger: z.number().int().optional(),
  deviceId: z.string().min(1).optional(),
});

export const reminderSnoozeBodySchema = z.object({
  snoozedUntil: z.number().int(),
  deviceId: z.string().min(1).optional(),
});

export type ReminderRecord = Readonly<{
  id: string;
  userId: string;
  title: string | null;
  triggerAt: Date;
  done: boolean | null;
  repeatRule: string | null;
  repeatConfig: Record<string, unknown> | null;
  repeat: ReminderRepeatRule | null;
  snoozedUntil: Date | null;
  active: boolean;
  scheduleStatus: string;
  timezone: string;
  baseAtLocal: string | null;
  startAt: Date | null;
  nextTriggerAt: Date | null;
  lastFiredAt: Date | null;
  lastAcknowledgedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export type ReminderCreateInput = Readonly<{
  id: string;
  userId: string;
  title: string | null;
  triggerAt: Date;
  done: boolean | null;
  repeatRule: string;
  repeatConfig: Record<string, unknown> | null;
  repeat: ReminderRepeatRule | null;
  snoozedUntil: Date | null;
  active: boolean;
  scheduleStatus: string;
  timezone: string;
  baseAtLocal: string | null;
  startAt: Date | null;
  nextTriggerAt: Date | null;
  lastFiredAt: Date | null;
  lastAcknowledgedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export type ReminderPatchInput = {
  title?: string | null;
  triggerAt?: Date;
  done?: boolean | null;
  repeatRule?: string | null;
  repeatConfig?: Record<string, unknown> | null;
  repeat?: ReminderRepeatRule | null;
  snoozedUntil?: Date | null;
  active?: boolean;
  scheduleStatus?: string;
  timezone?: string;
  baseAtLocal?: string | null;
  startAt?: Date | null;
  nextTriggerAt?: Date | null;
  lastFiredAt?: Date | null;
  lastAcknowledgedAt?: Date | null;
  version?: number;
  updatedAt?: Date;
};

export type ReminderUpdatePayload = Readonly<{
  title?: string | null;
  triggerAt?: number;
  done?: boolean | null;
  repeatRule?: string | null;
  repeatConfig?: Record<string, unknown> | null;
  repeat?: ReminderRepeatRule | null;
  snoozedUntil?: number | null;
  active?: boolean;
  scheduleStatus?: string | null;
  timezone?: string | null;
  baseAtLocal?: string | null;
  startAt?: number | null;
  nextTriggerAt?: number | null;
  lastFiredAt?: number | null;
  lastAcknowledgedAt?: number | null;
  updatedAt: number;
}>;

export const hasOwnField = <K extends string>(
  value: Record<string, unknown>,
  key: K,
): value is Record<K, unknown> => {
  return Object.prototype.hasOwnProperty.call(value, key);
};

const toNullableDate = (value: number | null | undefined): Date | null | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return new Date(value);
};

export const assertValidRepeatRule = (repeat: ReminderRepeatRule | null): void => {
  if (repeat === null) {
    return;
  }

  const parseResult = reminderRepeatSchema.safeParse(repeat);
  if (!parseResult.success) {
    throw new AppError({
      code: 'validation',
      message: 'Invalid repeat rule payload',
      details: {
        issues: parseResult.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'repeat',
          message: issue.message,
          code: issue.code,
        })),
      },
    });
  }
};

export const isValidIanaTimezone = (timezone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
};

export const assertValidTimezone = (timezone: string): void => {
  if (!isValidIanaTimezone(timezone)) {
    throw new AppError({
      code: 'validation',
      message: `Invalid timezone: ${timezone}`,
      details: {
        issues: [
          {
            path: 'timezone',
            message: 'Timezone must be a valid IANA zone',
            code: 'invalid_timezone',
          },
        ],
      },
    });
  }
};

export const toReminderPatch = (input: ReminderUpdatePayload): ReminderPatchInput => {
  const patch: ReminderPatchInput = {
    updatedAt: new Date(input.updatedAt),
  };

  const source = input as Record<string, unknown>;

  if (hasOwnField(source, 'title')) {
    patch.title = input.title ?? null;
  }
  if (hasOwnField(source, 'triggerAt')) {
    patch.triggerAt = new Date(input.triggerAt ?? Date.now());
  }
  if (hasOwnField(source, 'done')) {
    patch.done = input.done ?? null;
  }
  if (hasOwnField(source, 'repeatRule')) {
    patch.repeatRule = input.repeatRule ?? null;
  }
  if (hasOwnField(source, 'repeatConfig')) {
    patch.repeatConfig = input.repeatConfig ?? null;
  }
  if (hasOwnField(source, 'repeat')) {
    assertValidRepeatRule(input.repeat ?? null);
    patch.repeat = input.repeat ?? null;
  }
  if (hasOwnField(source, 'snoozedUntil')) {
    patch.snoozedUntil = toNullableDate(input.snoozedUntil);
  }
  if (hasOwnField(source, 'active')) {
    patch.active = input.active ?? true;
  }
  if (hasOwnField(source, 'scheduleStatus')) {
    patch.scheduleStatus = input.scheduleStatus ?? 'unscheduled';
  }
  if (hasOwnField(source, 'timezone')) {
    if (input.timezone === null) {
      throw new AppError({
        code: 'validation',
        message: 'Timezone cannot be null',
      });
    }

    patch.timezone = input.timezone;
  }

  if (hasOwnField(source, 'baseAtLocal')) {
    patch.baseAtLocal = input.baseAtLocal ?? null;
  }
  if (hasOwnField(source, 'startAt')) {
    patch.startAt = toNullableDate(input.startAt);
  }
  if (hasOwnField(source, 'nextTriggerAt')) {
    patch.nextTriggerAt = toNullableDate(input.nextTriggerAt);
  }
  if (hasOwnField(source, 'lastFiredAt')) {
    patch.lastFiredAt = toNullableDate(input.lastFiredAt);
  }
  if (hasOwnField(source, 'lastAcknowledgedAt')) {
    patch.lastAcknowledgedAt = toNullableDate(input.lastAcknowledgedAt);
  }

  return patch;
};
