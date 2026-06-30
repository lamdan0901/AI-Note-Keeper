import { z } from "zod";

import { AppError } from "@backend/middleware/error-middleware";
import type { PushJobHandler, PushJobRunResult } from "@backend/jobs/push/push-job-handler";
import type { QstashVerifierConfig } from "@backend/reminders/runtime";

import { createQstashVerifier, type QstashVerify } from "@/http/raw-body";
import { parseOrThrow } from "@/http/validate";

const pushDeliveryTokenSchema = z.object({
  deviceId: z.string().min(1),
  fcmToken: z.string().min(1),
});

export const pushRetryJobPayloadSchema = z.object({
  userId: z.string().min(1),
  reminderId: z.string().min(1),
  changeEventId: z.string().min(1),
  isTrigger: z.boolean().optional(),
  attempt: z.number().int().min(1),
  token: pushDeliveryTokenSchema,
  title: z.string().optional(),
  body: z.string().optional(),
});

export type PushRetryHandlerDeps = Readonly<{
  pushJobHandler: PushJobHandler;
}>;

export type PushRetryHandlerInput = Readonly<{
  parsedBody: unknown;
}>;

export type PushRetryHandler = (
  input: PushRetryHandlerInput,
) => Promise<PushJobRunResult>;

export const createPushRetryHandler = (deps: PushRetryHandlerDeps): PushRetryHandler => {
  return async (input: PushRetryHandlerInput): Promise<PushJobRunResult> => {
    const payload = parseOrThrow(pushRetryJobPayloadSchema, input.parsedBody);

    return await deps.pushJobHandler.handle({
      userId: payload.userId,
      reminderId: payload.reminderId,
      changeEventId: payload.changeEventId,
      isTrigger: payload.isTrigger,
      attempt: payload.attempt,
      tokens: [payload.token],
      title: payload.title,
      body: payload.body,
    });
  };
};

export type PushRetryCallbackHandlerDeps = Readonly<{
  pushJobHandler: PushJobHandler;
  verifierConfig: QstashVerifierConfig;
  verify?: QstashVerify;
}>;

export type PushRetryCallbackHandlerInput = Readonly<{
  rawBody: string | undefined;
  signature: string | undefined;
  parsedBody: unknown;
}>;

export type PushRetryCallbackHandler = (
  input: PushRetryCallbackHandlerInput,
) => Promise<PushJobRunResult>;

export const createPushRetryCallbackHandler = (
  deps: PushRetryCallbackHandlerDeps,
): PushRetryCallbackHandler => {
  const handler = createPushRetryHandler({ pushJobHandler: deps.pushJobHandler });
  const verify = deps.verify ?? createQstashVerifier(deps.verifierConfig);

  return async (input: PushRetryCallbackHandlerInput): Promise<PushJobRunResult> => {
    if (!input.signature || input.rawBody === undefined) {
      throw new AppError({
        code: "auth",
        message: "Invalid QStash signature",
      });
    }

    const verified = await verify({
      signature: input.signature,
      body: input.rawBody,
      url: deps.verifierConfig.callbackUrl,
    });

    if (!verified) {
      throw new AppError({
        code: "auth",
        message: "Invalid QStash signature",
      });
    }

    return await handler({ parsedBody: input.parsedBody });
  };
};