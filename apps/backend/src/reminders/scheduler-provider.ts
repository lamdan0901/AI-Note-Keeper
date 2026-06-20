import { Client } from '@upstash/qstash';

import type { ReminderSchedulerPayload } from './contracts.js';

export const REMINDER_QSTASH_PROVIDER = 'qstash' as const;

export type SchedulerScheduleInput = Readonly<{
  reminderId: string;
  occurrenceAt: Date;
  version: number;
  deliveryKey: string;
}>;

export type SchedulerScheduleResult = Readonly<{
  provider: string;
  scheduleId: string;
  fireAt: Date;
}>;

export type SchedulerProvider = Readonly<{
  readonly name: string;
  scheduleOnce: (input: SchedulerScheduleInput) => Promise<SchedulerScheduleResult>;
  cancel: (input: Readonly<{ scheduleId: string }>) => Promise<void>;
  describe?: (
    input: Readonly<{ scheduleId: string }>,
  ) => Promise<SchedulerScheduleResult | null>;
}>;

export type QstashClientLike = Readonly<{
  publishJSON: (
    input: Readonly<{
      url: string;
      body: ReminderSchedulerPayload;
      delay: number;
    }>,
  ) => Promise<Readonly<{ messageId: string }>>;
  messages: Readonly<{
    cancel: (messageId: string) => Promise<unknown>;
  }>;
}>;

const toPayload = (input: SchedulerScheduleInput): ReminderSchedulerPayload => ({
  reminderId: input.reminderId,
  occurrenceAt: input.occurrenceAt.toISOString(),
  version: input.version,
  deliveryKey: input.deliveryKey,
});

const secondsUntil = (fireAt: Date, now: Date): number => {
  return Math.max(0, Math.ceil((fireAt.getTime() - now.getTime()) / 1000));
};

export const createQstashClient = (
  input: Readonly<{ token: string; baseUrl?: string }>,
): QstashClientLike => {
  return new Client({
    token: input.token,
    baseUrl: input.baseUrl,
  }) as QstashClientLike;
};

export const createQstashSchedulerProvider = (
  input: Readonly<{
    client: QstashClientLike;
    callbackUrl: string;
    now?: () => Date;
  }>,
): SchedulerProvider => {
  const now = input.now ?? (() => new Date());

  return {
    name: REMINDER_QSTASH_PROVIDER,
    scheduleOnce: async (scheduleInput) => {
      const response = await input.client.publishJSON({
        url: input.callbackUrl,
        body: toPayload(scheduleInput),
        delay: secondsUntil(scheduleInput.occurrenceAt, now()),
      });

      return {
        provider: REMINDER_QSTASH_PROVIDER,
        scheduleId: response.messageId,
        fireAt: scheduleInput.occurrenceAt,
      };
    },
    cancel: async ({ scheduleId }) => {
      await input.client.messages.cancel(scheduleId).catch(() => undefined);
    },
  };
};

export const createDisabledSchedulerProvider = (): SchedulerProvider => ({
  name: 'disabled',
  scheduleOnce: async () => {
    throw new Error('Reminder scheduler provider is disabled');
  },
  cancel: async () => undefined,
});
