import { z } from "zod";

import type { AuthenticatedContext } from "@/http/types";

export type DeviceTokensHandler<TResult = unknown> = (
  ctx: AuthenticatedContext,
) => Promise<TResult>;

export const requireAuthUserId = (ctx: AuthenticatedContext): string => {
  return ctx.authUser.userId;
};

export const upsertBodySchema = z.object({
  deviceId: z.string().min(1),
  fcmToken: z.string().min(1),
  platform: z.literal("android"),
});

export const deviceIdParamsSchema = z.object({
  deviceId: z.string().min(1),
});

export type UpsertBody = z.infer<typeof upsertBodySchema>;