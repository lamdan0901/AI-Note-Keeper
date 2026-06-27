import { z } from "zod";

import { AppError } from "@backend/middleware/error-middleware";
import type { QstashVerifierConfig } from "@backend/reminders/runtime";
import type { ScheduledTaskExecutor } from "@backend/reminders/scheduled-task-executor";

import { createQstashVerifier, type QstashVerify } from "@/http/raw-body";
import { parseOrThrow } from "@/http/validate";

export const scheduledTaskBodySchema = z.object({
  reminderId: z.string().min(1),
  occurrenceAt: z.string().datetime(),
  version: z.number().int().positive(),
  deliveryKey: z.string().min(1),
});

type ScheduledTaskBody = z.infer<typeof scheduledTaskBodySchema>;

export type ScheduledTaskHandlerDeps = Readonly<{
  executor: ScheduledTaskExecutor;
  verifierConfig: QstashVerifierConfig;
  verify?: QstashVerify;
}>;

export type ScheduledTaskHandlerInput = Readonly<{
  rawBody: string | undefined;
  signature: string | undefined;
  parsedBody: unknown;
}>;

export type ScheduledTaskHandlerResult = Readonly<{ status: string }>;

export type ScheduledTaskHandler = (
  input: ScheduledTaskHandlerInput,
) => Promise<ScheduledTaskHandlerResult>;

export const createScheduledTaskHandler = (
  deps: ScheduledTaskHandlerDeps,
): ScheduledTaskHandler => {
  const verify = deps.verify ?? createQstashVerifier(deps.verifierConfig);

  return async (input: ScheduledTaskHandlerInput): Promise<ScheduledTaskHandlerResult> => {
    const payload: ScheduledTaskBody = parseOrThrow(scheduledTaskBodySchema, input.parsedBody);

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

    return await deps.executor.execute(payload);
  };
};