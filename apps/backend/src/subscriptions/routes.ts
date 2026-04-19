import { Router } from 'express';
import { z } from 'zod';

import { requireAccessUser, type AuthenticatedRequest } from '../auth/access-middleware.js';
import { validateRequest, withErrorBoundary } from '../middleware/validate.js';
import { createSubscriptionsService, type SubscriptionsService } from './service.js';
import type { BillingCycle, SubscriptionStatus } from './contracts.js';

const billingCycleSchema = z.enum(['weekly', 'monthly', 'yearly', 'custom']);
const statusSchema = z.enum(['active', 'paused', 'canceled']);

const subscriptionIdParamsSchema = z.object({
  subscriptionId: z.string().min(1),
});

const createSubscriptionSchema = z.object({
  serviceName: z.string().min(1),
  category: z.string().min(1),
  price: z.number(),
  currency: z.string().min(1),
  billingCycle: billingCycleSchema,
  billingCycleCustomDays: z.number().nullable().optional(),
  nextBillingDate: z.number(),
  notes: z.string().nullable().optional(),
  trialEndDate: z.number().nullable().optional(),
  status: statusSchema,
  reminderDaysBefore: z.array(z.number()).default([]),
});

const updateSubscriptionSchema = z.object({
  serviceName: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  price: z.number().optional(),
  currency: z.string().min(1).optional(),
  billingCycle: billingCycleSchema.optional(),
  billingCycleCustomDays: z.number().nullable().optional(),
  nextBillingDate: z.number().optional(),
  notes: z.string().nullable().optional(),
  trialEndDate: z.number().nullable().optional(),
  status: statusSchema.optional(),
  reminderDaysBefore: z.array(z.number()).optional(),
});

const getUserId = (request: AuthenticatedRequest): string => {
  return request.authUser.userId;
};

export const createSubscriptionsRoutes = (
  service: SubscriptionsService = createSubscriptionsService(),
): Router => {
  const router = Router();

  router.get(
    '/',
    requireAccessUser(),
    withErrorBoundary(async (request, response) => {
      const subscriptions = await service.list({
        userId: getUserId(request as AuthenticatedRequest),
      });
      response.status(200).json({ subscriptions });
    }),
  );

  router.post(
    '/',
    requireAccessUser(),
    validateRequest({ body: createSubscriptionSchema }),
    withErrorBoundary(async (request, response) => {
      const userId = getUserId(request as AuthenticatedRequest);
      const body = request.body as Readonly<{
        serviceName: string;
        category: string;
        price: number;
        currency: string;
        billingCycle: BillingCycle;
        billingCycleCustomDays?: number | null;
        nextBillingDate: number;
        notes?: string | null;
        trialEndDate?: number | null;
        status: SubscriptionStatus;
        reminderDaysBefore: ReadonlyArray<number>;
      }>;

      const created = await service.create({
        userId,
        serviceName: body.serviceName,
        category: body.category,
        price: body.price,
        currency: body.currency,
        billingCycle: body.billingCycle,
        billingCycleCustomDays: body.billingCycleCustomDays ?? null,
        nextBillingDate: new Date(body.nextBillingDate),
        notes: body.notes ?? null,
        trialEndDate: body.trialEndDate ? new Date(body.trialEndDate) : null,
        status: body.status,
        reminderDaysBefore: body.reminderDaysBefore,
      });

      response.status(201).json({ subscription: created });
    }),
  );

  router.patch(
    '/:subscriptionId',
    requireAccessUser(),
    validateRequest({ params: subscriptionIdParamsSchema, body: updateSubscriptionSchema }),
    withErrorBoundary(async (request, response) => {
      const userId = getUserId(request as AuthenticatedRequest);
      const { subscriptionId } = request.params as Readonly<{ subscriptionId: string }>;
      const body = request.body as Readonly<{
        serviceName?: string;
        category?: string;
        price?: number;
        currency?: string;
        billingCycle?: BillingCycle;
        billingCycleCustomDays?: number | null;
        nextBillingDate?: number;
        notes?: string | null;
        trialEndDate?: number | null;
        status?: SubscriptionStatus;
        reminderDaysBefore?: ReadonlyArray<number>;
      }>;

      const updated = await service.update({
        subscriptionId,
        userId,
        patch: {
          ...body,
          nextBillingDate: body.nextBillingDate ? new Date(body.nextBillingDate) : undefined,
          trialEndDate: Object.hasOwn(body, 'trialEndDate')
            ? body.trialEndDate
              ? new Date(body.trialEndDate)
              : null
            : undefined,
        },
      });

      response.status(200).json({ subscription: updated });
    }),
  );

  router.delete(
    '/:subscriptionId',
    requireAccessUser(),
    validateRequest({ params: subscriptionIdParamsSchema }),
    withErrorBoundary(async (request, response) => {
      const userId = getUserId(request as AuthenticatedRequest);
      const { subscriptionId } = request.params as Readonly<{ subscriptionId: string }>;
      const deleted = await service.trash({ subscriptionId, userId });
      response.status(200).json({ deleted });
    }),
  );

  router.post(
    '/:subscriptionId/restore',
    requireAccessUser(),
    validateRequest({ params: subscriptionIdParamsSchema }),
    withErrorBoundary(async (request, response) => {
      const userId = getUserId(request as AuthenticatedRequest);
      const { subscriptionId } = request.params as Readonly<{ subscriptionId: string }>;
      const restored = await service.restore({ subscriptionId, userId });
      response.status(200).json({ restored });
    }),
  );

  router.delete(
    '/:subscriptionId/permanent',
    requireAccessUser(),
    validateRequest({ params: subscriptionIdParamsSchema }),
    withErrorBoundary(async (request, response) => {
      const userId = getUserId(request as AuthenticatedRequest);
      const { subscriptionId } = request.params as Readonly<{ subscriptionId: string }>;
      const deleted = await service.permanentlyDelete({ subscriptionId, userId });
      response.status(200).json({ deleted });
    }),
  );

  return router;
};
