import { Router } from 'express';
import { z } from 'zod';

import { requireAccessUser, type AuthenticatedRequest } from '../auth/access-middleware.js';
import { AppError } from '../middleware/error-middleware.js';
import { validateRequest, withErrorBoundary } from '../middleware/validate.js';
import { createAiRateLimiter, type AiRateLimiter } from './rate-limit.js';
import { createAiService, type AiService } from './service.js';

const repeatSchema = z
  .union([
    z.object({ kind: z.literal('daily'), interval: z.number().int().positive() }),
    z.object({
      kind: z.literal('weekly'),
      interval: z.number().int().positive(),
      weekdays: z.array(z.number().int()),
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
  ])
  .nullable();

const parseVoiceBodySchema = z.object({
  transcript: z.string().min(1),
  userId: z.string().min(1),
  timezone: z.string().min(1),
  nowEpochMs: z.number(),
  locale: z.string().nullable(),
  sessionId: z.string().min(1),
});

const clarifyBodySchema = z.object({
  sessionId: z.string().min(1),
  priorDraft: z.object({
    title: z.string().nullable(),
    content: z.string().nullable(),
    reminderAtEpochMs: z.number().nullable(),
    repeat: repeatSchema,
    keepTranscriptInContent: z.boolean(),
    normalizedTranscript: z.string().min(1),
  }),
  clarificationAnswer: z.string().min(1),
  timezone: z.string().min(1),
  nowEpochMs: z.number(),
});

export const createAiRoutes = (
  service: AiService = createAiService(),
  limiter: AiRateLimiter = createAiRateLimiter(),
): Router => {
  const router = Router();

  router.post(
    '/parse-voice',
    requireAccessUser(),
    validateRequest({ body: parseVoiceBodySchema }),
    withErrorBoundary(async (request, response) => {
      const authUser = (request as AuthenticatedRequest).authUser;
      const body = request.body as z.infer<typeof parseVoiceBodySchema>;

      if (body.userId !== authUser.userId) {
        throw new AppError({
          code: 'forbidden',
          message: 'Request userId must match authenticated user',
        });
      }

      limiter.enforce({ userId: authUser.userId, endpoint: 'parse' });
      const result = await service.parseVoiceNoteIntent(body);

      response.status(200).json(result);
    }),
  );

  router.post(
    '/clarify',
    requireAccessUser(),
    validateRequest({ body: clarifyBodySchema }),
    withErrorBoundary(async (request, response) => {
      const authUser = (request as AuthenticatedRequest).authUser;
      const body = request.body as z.infer<typeof clarifyBodySchema>;

      limiter.enforce({ userId: authUser.userId, endpoint: 'clarify' });
      const result = await service.continueVoiceClarification(body);

      response.status(200).json(result);
    }),
  );

  return router;
};
