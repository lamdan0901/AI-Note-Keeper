import type { ReminderSchedulerPayload } from './contracts.js';
import type { SchedulerProvider, SchedulerScheduleInput } from './scheduler-provider.js';

type FetchLike = typeof globalThis.fetch;

const QSTASH_BASE_URL = 'https://qstash.upstash.io';

const toPayload = (input: SchedulerScheduleInput): ReminderSchedulerPayload => ({
  reminderId: input.reminderId,
  occurrenceAt: input.occurrenceAt.toISOString(),
  version: input.version,
  deliveryKey: input.deliveryKey,
});

const assertOkResponse = async (response: Response, action: string): Promise<void> => {
  if (response.ok) {
    return;
  }

  const body = await response.text().catch(() => '');
  throw new Error(`QStash ${action} failed with ${response.status}: ${body}`);
};

const toNotBeforeSeconds = (date: Date): number => Math.floor(date.getTime() / 1000);

export type QStashSchedulerProviderOptions = Readonly<{
  token: string;
  callbackUrl: string;
  secret: string;
  fetchImpl?: FetchLike;
}>;

export const createQStashSchedulerProvider = (
  options: QStashSchedulerProviderOptions,
): SchedulerProvider => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const authHeader = `Bearer ${options.token}`;

  return {
    name: 'qstash',
    scheduleOnce: async (scheduleInput) => {
      const destination = encodeURIComponent(options.callbackUrl);
      const response = await fetchImpl(
        `${QSTASH_BASE_URL}/v2/publish/${destination}`,
        {
          method: 'POST',
          headers: {
            'authorization': authHeader,
            'content-type': 'application/json',
            'upstash-not-before': String(toNotBeforeSeconds(scheduleInput.occurrenceAt)),
            'upstash-forward-x-reminder-scheduler-secret': options.secret,
          },
          body: JSON.stringify(toPayload(scheduleInput)),
        },
      );
      await assertOkResponse(response, 'publish');

      const qstashBody = (await response.json()) as { messageId: string };
      return {
        provider: 'qstash',
        scheduleId: qstashBody.messageId,
        fireAt: scheduleInput.occurrenceAt,
      };
    },
    cancel: async ({ scheduleId }) => {
      await fetchImpl(`${QSTASH_BASE_URL}/v2/messages/${scheduleId}`, {
        method: 'DELETE',
        headers: {
          authorization: authHeader,
        },
      }).catch(() => undefined);
    },
  };
};
