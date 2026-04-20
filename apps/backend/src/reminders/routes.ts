import { Router } from 'express';
import { z } from 'zod';

import { requireAccessUser, type AuthenticatedRequest } from '../auth/access-middleware.js';
import { AppError } from '../middleware/error-middleware.js';
import { validateRequest, withErrorBoundary } from '../middleware/validate.js';
import {
  reminderAckBodySchema,
  reminderCreateBodySchema,
  reminderSnoozeBodySchema,
  reminderUpdateBodySchema,
  type ReminderUpdatePayload,
} from './contracts.js';
import { createRemindersService, type RemindersService } from './service.js';

const reminderIdParamsSchema = z.object({
  reminderId: z.string().min(1),
});

const listQuerySchema = z.object({
  updatedSince: z.coerce.number().int().optional(),
});

type ReminderCreateBody = z.infer<typeof reminderCreateBodySchema>;
type ReminderUpdateBody = z.infer<typeof reminderUpdateBodySchema>;
type ReminderAckBody = z.infer<typeof reminderAckBodySchema>;
type ReminderSnoozeBody = z.infer<typeof reminderSnoozeBodySchema>;

const requireUserId = (request: AuthenticatedRequest): string => {
  return request.authUser.userId;
};

export const createRemindersRoutes = (
  service: RemindersService = createRemindersService(),
): Router => {
  const router = Router();

  router.get(
    '/',
    requireAccessUser(),
    withErrorBoundary(async (request, response) => {
      const userId = requireUserId(request as AuthenticatedRequest);
      const parsedQuery = listQuerySchema.safeParse(request.query);

      if (!parsedQuery.success) {
        throw new AppError({
          code: 'validation',
          details: {
            issues: parsedQuery.error.issues.map((issue) => ({
              path: issue.path.map(String).join('.') || 'query',
              message: issue.message,
              code: issue.code,
            })),
          },
        });
      }

      const reminders = await service.listReminders({
        userId,
        updatedSince: parsedQuery.data.updatedSince,
      });

      response.status(200).json({ reminders });
    }),
  );

  router.get(
    '/:reminderId',
    requireAccessUser(),
    validateRequest({ params: reminderIdParamsSchema }),
    withErrorBoundary(async (request, response) => {
      const userId = requireUserId(request as AuthenticatedRequest);
      const { reminderId } = request.params as z.infer<typeof reminderIdParamsSchema>;

      const reminder = await service.getReminder({ userId, reminderId });
      response.status(200).json({ reminder });
    }),
  );

  router.post(
    '/',
    requireAccessUser(),
    validateRequest({ body: reminderCreateBodySchema }),
    withErrorBoundary(async (request, response) => {
      const userId = requireUserId(request as AuthenticatedRequest);
      const body = request.body as ReminderCreateBody;

      const reminder = await service.createReminder({
        ...body,
        userId,
      });

      response.status(200).json({ reminder });
    }),
  );

  router.patch(
    '/:reminderId',
    requireAccessUser(),
    validateRequest({ params: reminderIdParamsSchema, body: reminderUpdateBodySchema }),
    withErrorBoundary(async (request, response) => {
      const userId = requireUserId(request as AuthenticatedRequest);
      const { reminderId } = request.params as z.infer<typeof reminderIdParamsSchema>;
      const body = request.body as ReminderUpdateBody;

      const before = await service.getReminder({ userId, reminderId });
      const reminder = await service.updateReminder({
        userId,
        reminderId,
        patch: body as ReminderUpdatePayload,
        deviceId: body.deviceId,
      });

      const updated =
        before !== null &&
        reminder !== null &&
        reminder.updatedAt.getTime() !== before.updatedAt.getTime();

      response.status(200).json({
        updated,
        reminder,
      });
    }),
  );

  router.delete(
    '/:reminderId',
    requireAccessUser(),
    validateRequest({ params: reminderIdParamsSchema }),
    withErrorBoundary(async (request, response) => {
      const userId = requireUserId(request as AuthenticatedRequest);
      const { reminderId } = request.params as z.infer<typeof reminderIdParamsSchema>;

      const deleted = await service.deleteReminder({
        userId,
        reminderId,
      });

      response.status(200).json({ deleted });
    }),
  );

  router.post(
    '/:reminderId/ack',
    requireAccessUser(),
    validateRequest({ params: reminderIdParamsSchema, body: reminderAckBodySchema }),
    withErrorBoundary(async (request, response) => {
      const userId = requireUserId(request as AuthenticatedRequest);
      const { reminderId } = request.params as z.infer<typeof reminderIdParamsSchema>;
      const body = request.body as ReminderAckBody;

      const reminder = await service.ackReminder({
        userId,
        reminderId,
        ackType: body.ackType,
        deviceId: body.deviceId,
      });

      response.status(200).json({
        updated: reminder !== null,
        reminder,
      });
    }),
  );

  router.post(
    '/:reminderId/snooze',
    requireAccessUser(),
    validateRequest({ params: reminderIdParamsSchema, body: reminderSnoozeBodySchema }),
    withErrorBoundary(async (request, response) => {
      const userId = requireUserId(request as AuthenticatedRequest);
      const { reminderId } = request.params as z.infer<typeof reminderIdParamsSchema>;
      const body = request.body as ReminderSnoozeBody;

      const before = await service.getReminder({ userId, reminderId });
      const reminder = await service.snoozeReminder({
        userId,
        reminderId,
        snoozedUntil: body.snoozedUntil,
        deviceId: body.deviceId,
      });

      const updated =
        before !== null &&
        reminder !== null &&
        reminder.updatedAt.getTime() !== before.updatedAt.getTime();

      response.status(200).json({
        updated,
        reminder,
      });
    }),
  );

  return router;
};
