import { z } from "zod";

import type { SubscriptionUpdatePatch } from "@backend/subscriptions/contracts.js";

import type { AuthenticatedContext } from "@/http/types";

export type SubscriptionsHandler<TResult = unknown> = (
  ctx: AuthenticatedContext,
) => Promise<TResult>;

export const requireAuthUserId = (ctx: AuthenticatedContext): string => {
  return ctx.authUser.userId;
};

export const billingCycleSchema = z.enum(["weekly", "monthly", "yearly", "custom"]);
export const statusSchema = z.enum(["active", "paused", "canceled"]);

export const subscriptionIdParamsSchema = z.object({
  subscriptionId: z.string().min(1),
});

export const createSubscriptionSchema = z.object({
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

export const updateSubscriptionSchema = z.object({
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

export type CreateSubscriptionBody = z.infer<typeof createSubscriptionSchema>;
export type UpdateSubscriptionBody = z.infer<typeof updateSubscriptionSchema>;

export const toDateOrNull = (epochMs: number | null | undefined): Date | null => {
  if (epochMs === null || epochMs === undefined) {
    return null;
  }

  return new Date(epochMs);
};

export const buildUpdatePatch = (body: UpdateSubscriptionBody): SubscriptionUpdatePatch => {
  return {
    ...body,
    nextBillingDate:
      body.nextBillingDate === undefined ? undefined : new Date(body.nextBillingDate),
    trialEndDate: Object.hasOwn(body, "trialEndDate")
      ? body.trialEndDate === null || body.trialEndDate === undefined
        ? null
        : new Date(body.trialEndDate)
      : undefined,
  };
};