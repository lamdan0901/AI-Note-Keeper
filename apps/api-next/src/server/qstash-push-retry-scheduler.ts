import { Client } from "@upstash/qstash";

import type { PushRetryJobPayload, PushRetryScheduler } from "@backend/jobs/push/contracts";
import { readReminderSchedulerConfig } from "@backend/config";

export type QstashPushPublishClient = Readonly<{
  publishJSON: (
    input: Readonly<{
      url: string;
      body: PushRetryJobPayload;
      delay: number;
      deduplicationId?: string;
    }>,
  ) => Promise<Readonly<{ messageId: string }>>;
}>;

export const createPushRetryCallbackUrl = (baseUrl: string): string => {
  return new URL("/internal/push/retry", baseUrl).toString();
};

const delaySeconds = (delayMs: number): number => {
  return Math.max(0, Math.ceil(delayMs / 1000));
};

export const createQstashPushPublishClient = (
  input: Readonly<{ token: string; baseUrl?: string }>,
): QstashPushPublishClient => {
  const client = new Client({
    token: input.token,
    baseUrl: input.baseUrl,
  });

  return {
    publishJSON: async (publishInput) => {
      const response = await client.publishJSON({
        url: publishInput.url,
        body: publishInput.body,
        delay: publishInput.delay,
        deduplicationId: publishInput.deduplicationId,
      });

      return { messageId: response.messageId };
    },
  };
};

export type QstashPushRetrySchedulerDeps = Readonly<{
  schedulerProvider?: "qstash" | "disabled";
  callbackBaseUrl?: string;
  qstashToken?: string;
  qstashUrl?: string;
  client?: QstashPushPublishClient;
}>;

export const createQstashPushRetryScheduler = (
  deps: QstashPushRetrySchedulerDeps,
): PushRetryScheduler => {
  const schedulerConfig = readReminderSchedulerConfig();
  const provider = deps.schedulerProvider ?? schedulerConfig.REMINDER_SCHEDULER_PROVIDER;

  if (provider === "disabled") {
    throw new Error("Push retry scheduler is disabled when REMINDER_SCHEDULER_PROVIDER=disabled");
  }

  const callbackBaseUrl =
    deps.callbackBaseUrl ?? schedulerConfig.REMINDER_SCHEDULER_CALLBACK_BASE_URL;
  const token = deps.qstashToken ?? schedulerConfig.QSTASH_TOKEN;

  if (!callbackBaseUrl) {
    throw new Error("REMINDER_SCHEDULER_CALLBACK_BASE_URL is required for push retry scheduler");
  }

  if (!token) {
    throw new Error("QSTASH_TOKEN is required for push retry scheduler");
  }

  const client =
    deps.client ??
    createQstashPushPublishClient({
      token,
      baseUrl: deps.qstashUrl ?? schedulerConfig.QSTASH_URL,
    });
  const callbackUrl = createPushRetryCallbackUrl(callbackBaseUrl);

  return {
    scheduleRetry: async ({ delayMs, job, jobKey }) => {
      await client.publishJSON({
        url: callbackUrl,
        body: job,
        delay: delaySeconds(delayMs),
        deduplicationId: jobKey,
      });
    },
  };
};