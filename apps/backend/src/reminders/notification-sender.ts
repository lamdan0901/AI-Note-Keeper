import type { DeviceTokensRepository } from '../device-tokens/repositories/device-tokens-repository.js';
import type { PushDeliveryService } from '../jobs/push/contracts.js';
import type { ReminderRecord } from './contracts.js';
import { renderReminderNotificationText } from './notification-text.js';

export type ReminderNotificationSendResult = Readonly<{
  status: 'sent' | 'failed';
  delivered: number;
  failed: number;
  reason?: string;
  providerMessageId?: string;
}>;

export type ReminderNotificationSender = Readonly<{
  sendReminderNotification: (
    input: Readonly<{ reminder: ReminderRecord; deliveryKey: string; attempt: number }>,
  ) => Promise<ReminderNotificationSendResult>;
}>;

export const createReminderNotificationSender = (
  deps: Readonly<{
    deviceTokensRepository: Pick<DeviceTokensRepository, 'listByUserId'>;
    pushDeliveryService: PushDeliveryService;
  }>,
): ReminderNotificationSender => ({
  sendReminderNotification: async ({ reminder, deliveryKey, attempt }) => {
    const text = renderReminderNotificationText(reminder);
    const tokens = await deps.deviceTokensRepository.listByUserId(reminder.userId);
    if (tokens.length === 0) {
      return { status: 'failed', delivered: 0, failed: 0, reason: 'no_device_tokens' };
    }

    let delivered = 0;
    let failed = 0;
    let lastFailure: string | undefined;

    for (const token of tokens) {
      const result = await deps.pushDeliveryService.deliverToToken({
        userId: reminder.userId,
        reminderId: reminder.id,
        changeEventId: deliveryKey,
        isTrigger: true,
        attempt,
        token: {
          deviceId: token.deviceId,
          fcmToken: token.fcmToken,
        },
        title: text.title,
        body: text.body,
      });

      if (result.classification === 'delivered') {
        delivered += 1;
        continue;
      }

      failed += 1;
      lastFailure = result.errorCode ?? result.message ?? result.classification;
    }

    if (delivered > 0) {
      return {
        status: 'sent',
        delivered,
        failed,
        providerMessageId: `tokens:${delivered}`,
      };
    }

    return {
      status: 'failed',
      delivered,
      failed,
      reason: lastFailure ?? 'all_push_attempts_failed',
    };
  },
});
