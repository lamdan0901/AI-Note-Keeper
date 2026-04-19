import { Router } from 'express';
import { z } from 'zod';

import { requireAccessUser, type AuthenticatedRequest } from '../auth/access-middleware.js';
import { validateRequest, withErrorBoundary } from '../middleware/validate.js';
import { createNotesService, type NotesService } from './service.js';
import type { NoteSyncChange } from './contracts.js';

const noteIdParamsSchema = z.object({
  noteId: z.string().min(1),
});

const syncChangeSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  operation: z.enum(['create', 'update', 'delete']),
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

const syncBodySchema = z.object({
  lastSyncAt: z.number(),
  changes: z.array(syncChangeSchema),
});

type SyncRequestBody = Readonly<{
  lastSyncAt: number;
  changes: ReadonlyArray<NoteSyncChange>;
}>;

const requireUserId = (request: AuthenticatedRequest): string => {
  return request.authUser.userId;
};

export const createNotesRoutes = (service: NotesService = createNotesService()): Router => {
  const router = Router();

  router.get(
    '/',
    requireAccessUser(),
    withErrorBoundary(async (request, response) => {
      const userId = requireUserId(request as AuthenticatedRequest);
      const notes = await service.listNotes({ userId });
      response.status(200).json({ notes });
    }),
  );

  router.post(
    '/sync',
    requireAccessUser(),
    validateRequest({ body: syncBodySchema }),
    withErrorBoundary(async (request, response) => {
      const userId = requireUserId(request as AuthenticatedRequest);
      const body = request.body as SyncRequestBody;

      const normalizedChanges = body.changes.map((change) => ({
        ...change,
        userId,
      }));

      const result = await service.sync({
        userId,
        lastSyncAt: body.lastSyncAt,
        changes: normalizedChanges,
      });

      response.status(200).json(result);
    }),
  );

  router.delete(
    '/trash/empty',
    requireAccessUser(),
    withErrorBoundary(async (request, response) => {
      const userId = requireUserId(request as AuthenticatedRequest);
      const deleted = await service.emptyTrash({ userId });
      response.status(200).json({ deleted });
    }),
  );

  router.post(
    '/:noteId/restore',
    requireAccessUser(),
    validateRequest({ params: noteIdParamsSchema }),
    withErrorBoundary(async (request, response) => {
      const userId = requireUserId(request as AuthenticatedRequest);
      const { noteId } = request.params as Readonly<{ noteId: string }>;
      const restored = await service.restoreNote({ userId, noteId });
      response.status(200).json({ restored });
    }),
  );

  router.delete(
    '/:noteId/permanent',
    requireAccessUser(),
    validateRequest({ params: noteIdParamsSchema }),
    withErrorBoundary(async (request, response) => {
      const userId = requireUserId(request as AuthenticatedRequest);
      const { noteId } = request.params as Readonly<{ noteId: string }>;
      const deleted = await service.permanentlyDeleteNote({ userId, noteId });
      response.status(200).json({ deleted });
    }),
  );

  router.delete(
    '/:noteId',
    requireAccessUser(),
    validateRequest({ params: noteIdParamsSchema }),
    withErrorBoundary(async (request, response) => {
      const userId = requireUserId(request as AuthenticatedRequest);
      const { noteId } = request.params as Readonly<{ noteId: string }>;
      const deleted = await service.trashNote({ userId, noteId });
      response.status(200).json({ deleted });
    }),
  );

  return router;
};
