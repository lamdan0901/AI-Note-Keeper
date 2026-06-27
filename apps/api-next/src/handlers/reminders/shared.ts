import { z } from "zod";

import {
  reminderAckBodySchema,
  reminderCreateBodySchema,
  reminderSnoozeBodySchema,
  reminderUpdateBodySchema,
  type ReminderRecord,
} from "@backend/reminders/contracts.js";

import type { AuthenticatedContext } from "@/http/types";

export {
  reminderAckBodySchema,
  reminderCreateBodySchema,
  reminderSnoozeBodySchema,
  reminderUpdateBodySchema,
};

export type RemindersHandler<TResult = unknown> = (
  ctx: AuthenticatedContext,
) => Promise<TResult>;

export type ReminderCreateBody = z.infer<typeof reminderCreateBodySchema>;
export type ReminderUpdateBody = z.infer<typeof reminderUpdateBodySchema>;
export type ReminderAckBody = z.infer<typeof reminderAckBodySchema>;
export type ReminderSnoozeBody = z.infer<typeof reminderSnoozeBodySchema>;

export type PublicReminderRecord = Omit<
  ReminderRecord,
  | "scheduleProvider"
  | "scheduleTargetId"
  | "scheduleTargetVersion"
  | "scheduleTargetFireAt"
  | "content"
  | "contentType"
>;

export const reminderIdParamsSchema = z.object({
  reminderId: z.string().min(1),
});

export const listQuerySchema = z.object({
  updatedSince: z.coerce.number().int().optional(),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

export const requireAuthUserId = (ctx: AuthenticatedContext): string => {
  return ctx.authUser.userId;
};

export const serializeReminder = (
  reminder: ReminderRecord | null,
): PublicReminderRecord | null => {
  if (reminder === null) {
    return null;
  }

  const {
    scheduleProvider: _scheduleProvider,
    scheduleTargetId: _scheduleTargetId,
    scheduleTargetVersion: _scheduleTargetVersion,
    scheduleTargetFireAt: _scheduleTargetFireAt,
    content: _content,
    contentType: _contentType,
    ...publicReminder
  } = reminder;

  return publicReminder as PublicReminderRecord;
};

export const stripClientUserId = <T extends { userId?: string }>(
  body: T,
): Omit<T, "userId"> => {
  const { userId: _userId, ...rest } = body;
  return rest;
};

export const computeReminderUpdated = (
  before: ReminderRecord | null,
  after: ReminderRecord | null,
): boolean => {
  return (
    before !== null &&
    after !== null &&
    after.updatedAt.getTime() !== before.updatedAt.getTime()
  );
};