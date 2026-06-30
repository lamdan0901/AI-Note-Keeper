import { z } from "zod";

import type { NoteSyncChange } from "@backend/notes/contracts.js";

import { AppError } from "@backend/middleware/error-middleware";

import type { AuthenticatedContext, RequestContext } from "@/http/types";

export type NotesHandler<TResult = unknown> = (
  ctx: AuthenticatedContext,
) => Promise<TResult>;

export const noteIdParamsSchema = z.object({
  noteId: z.string().min(1),
});

export const syncChangeSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  operation: z.enum(["create", "update", "delete"]),
  payloadHash: z.string().min(1),
  deviceId: z.string().min(1),
  updatedAt: z.number(),
  createdAt: z.number().optional(),
  title: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  contentType: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  active: z.boolean().optional(),
  done: z.boolean().nullable().optional(),
  isPinned: z.boolean().nullable().optional(),
  triggerAt: z.number().nullable().optional(),
  repeatRule: z.string().nullable().optional(),
  repeatConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  snoozedUntil: z.number().nullable().optional(),
  scheduleStatus: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  deletedAt: z.number().nullable().optional(),
  repeat: z.record(z.string(), z.unknown()).nullable().optional(),
  startAt: z.number().nullable().optional(),
  baseAtLocal: z.string().nullable().optional(),
  nextTriggerAt: z.number().nullable().optional(),
  lastFiredAt: z.number().nullable().optional(),
  lastAcknowledgedAt: z.number().nullable().optional(),
});

export const syncBodySchema = z.object({
  lastSyncAt: z.number(),
  changes: z.array(syncChangeSchema),
});

export const toAuthenticatedContext = (ctx: RequestContext): AuthenticatedContext => {
  if (!ctx.authUser) {
    throw new AppError({ code: "auth", message: "Access token is required" });
  }

  return { ...ctx, authUser: ctx.authUser };
};

export const requireAuthUserId = (ctx: AuthenticatedContext): string => {
  return ctx.authUser.userId;
};

export const normalizeSyncChanges = (
  userId: string,
  changes: ReadonlyArray<NoteSyncChange>,
): ReadonlyArray<NoteSyncChange> => {
  return changes.map((change) => ({
    ...change,
    userId,
  }));
};