import { Receiver } from '@upstash/qstash';
import type { Request } from 'express';
import { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../middleware/error-middleware.js';
import { validateRequest, withErrorBoundary } from '../middleware/validate.js';
import type { ReminderSchedulerPayload } from './contracts.js';
import type { QstashVerifierConfig } from './runtime.js';
import type { ScheduledTaskExecutor } from './scheduled-task-executor.js';

type RawBodyRequest = Request & Readonly<{ rawBody?: string }>;

type QstashVerifyInput = Readonly<{
  signature: string;
  body: string;
  url: string;
}>;

type QstashVerify = (input: QstashVerifyInput) => Promise<boolean>;

const scheduledTaskBodySchema = z.object({
  reminderId: z.string().min(1),
  occurrenceAt: z.string().datetime(),
  version: z.number().int().positive(),
  deliveryKey: z.string().min(1),
});

const createVerifier = (config: QstashVerifierConfig): QstashVerify => {
  const receiver = new Receiver({
    currentSigningKey: config.currentSigningKey,
    nextSigningKey: config.nextSigningKey,
  });

  return async (input) => await receiver.verify(input);
};

export const createReminderInternalRoutes = (
  input: Readonly<{
    executor: ScheduledTaskExecutor;
    verifierConfig: QstashVerifierConfig;
    verify?: QstashVerify;
  }>,
): Router => {
  const router = Router();
  const verify = input.verify ?? createVerifier(input.verifierConfig);

  router.post(
    '/scheduled-task',
    validateRequest({ body: scheduledTaskBodySchema }),
    withErrorBoundary(async (request, response) => {
      const signature = request.header('Upstash-Signature');
      const rawBody = (request as RawBodyRequest).rawBody;

      if (!signature || rawBody === undefined) {
        throw new AppError({
          code: 'auth',
          message: 'Invalid QStash signature',
        });
      }

      const verified = await verify({
        signature,
        body: rawBody,
        url: input.verifierConfig.callbackUrl,
      });

      if (!verified) {
        throw new AppError({
          code: 'auth',
          message: 'Invalid QStash signature',
        });
      }

      const result = await input.executor.execute(request.body as ReminderSchedulerPayload);
      response.status(200).json(result);
    }),
  );

  return router;
};
