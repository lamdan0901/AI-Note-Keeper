import type { SubscriptionsRepository } from '../../subscriptions/repositories/subscriptions-repository.js';
import { createSubscriptionsRepository } from '../../subscriptions/repositories/subscriptions-repository.js';
import type { SubscriptionReminderStateRepository } from './contracts.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const computeNextReminderAt = (
  anchorDate: Date,
  reminderDaysBefore: ReadonlyArray<number>,
  nowMs: number,
): Date | null => {
  const candidates = reminderDaysBefore
    .map((daysBefore) => anchorDate.getTime() - daysBefore * DAY_MS)
    .filter((candidate) => candidate > nowMs)
    .sort((left, right) => left - right);

  return candidates.length > 0 ? new Date(candidates[0]) : null;
};

export const createSubscriptionReminderStateRepository = (
  deps: Readonly<{
    subscriptionsRepository?: Pick<SubscriptionsRepository, 'findByIdForUser' | 'patch'>;
  }> = {},
): SubscriptionReminderStateRepository => {
  const subscriptionsRepository = deps.subscriptionsRepository ?? createSubscriptionsRepository();

  return {
    markBillingReminderSent: async ({ subscriptionId, userId, anchorDate, triggerTime }) => {
      const existing = await subscriptionsRepository.findByIdForUser({ subscriptionId, userId });
      if (!existing) {
        return;
      }

      const nextReminderAt = computeNextReminderAt(
        anchorDate,
        existing.reminderDaysBefore,
        triggerTime.getTime(),
      );

      await subscriptionsRepository.patch({
        subscriptionId,
        userId,
        patch: {
          lastNotifiedBillingDate: anchorDate,
          nextReminderAt,
          updatedAt: triggerTime,
        },
      });
    },

    markTrialReminderSent: async ({ subscriptionId, userId, anchorDate, triggerTime }) => {
      const existing = await subscriptionsRepository.findByIdForUser({ subscriptionId, userId });
      if (!existing) {
        return;
      }

      const nextTrialReminderAt = computeNextReminderAt(
        anchorDate,
        existing.reminderDaysBefore,
        triggerTime.getTime(),
      );

      await subscriptionsRepository.patch({
        subscriptionId,
        userId,
        patch: {
          lastNotifiedTrialEndDate: anchorDate,
          nextTrialReminderAt,
          updatedAt: triggerTime,
        },
      });
    },
  };
};
