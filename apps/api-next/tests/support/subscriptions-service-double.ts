import { AppError } from "@backend/middleware/error-middleware";
import type { SubscriptionRecord } from "@backend/subscriptions/contracts.js";
import type { SubscriptionsService } from "@backend/subscriptions/service";

export const DAY_MS = 24 * 60 * 60 * 1000;

export type NowRef = Readonly<{
  nowMs: () => number;
}>;

/**
 * Stateful in-memory SubscriptionsService double mirroring backend route contract tests.
 * Supports injectable `nowMs` for time-dependent purge and reminder scenarios.
 */
export const createSubscriptionsServiceDouble = (
  nowRef: NowRef,
): SubscriptionsService => {
  const byUser = new Map<string, Map<string, SubscriptionRecord>>();

  const getUserMap = (userId: string): Map<string, SubscriptionRecord> => {
    const existing = byUser.get(userId);
    if (existing) {
      return existing;
    }

    const created = new Map<string, SubscriptionRecord>();
    byUser.set(userId, created);
    return created;
  };

  const computeNextReminderAt = (
    nextBillingDate: Date,
    reminderDaysBefore: ReadonlyArray<number>,
  ): Date | null => {
    const candidates = reminderDaysBefore
      .map((days) => nextBillingDate.getTime() - days * DAY_MS)
      .filter((candidate) => candidate > nowRef.nowMs())
      .sort((a, b) => a - b);

    return candidates.length > 0 ? new Date(candidates[0]) : null;
  };

  const computeNextTrialReminderAt = (
    trialEndDate: Date | null,
    reminderDaysBefore: ReadonlyArray<number>,
  ): Date | null => {
    if (!trialEndDate) {
      return null;
    }

    return computeNextReminderAt(trialEndDate, reminderDaysBefore);
  };

  return {
    list: async ({ userId }) => [...getUserMap(userId).values()].filter((entry) => entry.active),
    listTrashed: async ({ userId }) =>
      [...getUserMap(userId).values()].filter((entry) => !entry.active),

    create: async (input) => {
      const now = new Date(nowRef.nowMs());
      const id = `sub-${getUserMap(input.userId).size + 1}`;
      const record: SubscriptionRecord = {
        id,
        userId: input.userId,
        serviceName: input.serviceName,
        category: input.category,
        price: input.price,
        currency: input.currency,
        billingCycle: input.billingCycle,
        billingCycleCustomDays: input.billingCycleCustomDays,
        nextBillingDate: input.nextBillingDate,
        notes: input.notes,
        trialEndDate: input.trialEndDate,
        status: input.status,
        reminderDaysBefore: [...input.reminderDaysBefore],
        nextReminderAt: computeNextReminderAt(input.nextBillingDate, input.reminderDaysBefore),
        lastNotifiedBillingDate: null,
        nextTrialReminderAt: computeNextTrialReminderAt(
          input.trialEndDate,
          input.reminderDaysBefore,
        ),
        lastNotifiedTrialEndDate: null,
        active: true,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      getUserMap(input.userId).set(id, record);
      return record;
    },

    update: async ({ subscriptionId, userId, patch }) => {
      const userSubscriptions = getUserMap(userId);
      const existing = userSubscriptions.get(subscriptionId);
      if (!existing) {
        throw new AppError({
          code: "not_found",
          message: "Subscription not found",
        });
      }

      const merged = {
        ...existing,
        ...patch,
      };

      const updated: SubscriptionRecord = {
        ...existing,
        ...patch,
        nextBillingDate: merged.nextBillingDate,
        trialEndDate: merged.trialEndDate,
        reminderDaysBefore: merged.reminderDaysBefore,
        nextReminderAt: computeNextReminderAt(merged.nextBillingDate, merged.reminderDaysBefore),
        nextTrialReminderAt: computeNextTrialReminderAt(
          merged.trialEndDate,
          merged.reminderDaysBefore,
        ),
        updatedAt: new Date(nowRef.nowMs()),
      };
      userSubscriptions.set(subscriptionId, updated);
      return updated;
    },

    trash: async ({ subscriptionId, userId }) => {
      const userSubscriptions = getUserMap(userId);
      const existing = userSubscriptions.get(subscriptionId);
      if (!existing) {
        return false;
      }

      userSubscriptions.set(subscriptionId, {
        ...existing,
        active: false,
        deletedAt: new Date(nowRef.nowMs()),
        updatedAt: new Date(nowRef.nowMs()),
      });
      return true;
    },

    restore: async ({ subscriptionId, userId }) => {
      const userSubscriptions = getUserMap(userId);
      const existing = userSubscriptions.get(subscriptionId);
      if (!existing) {
        return false;
      }

      userSubscriptions.set(subscriptionId, {
        ...existing,
        active: true,
        deletedAt: null,
        updatedAt: new Date(nowRef.nowMs()),
      });
      return true;
    },

    permanentlyDelete: async ({ subscriptionId, userId }) => {
      const userSubscriptions = getUserMap(userId);
      const existing = userSubscriptions.get(subscriptionId);
      if (!existing || existing.active) {
        return false;
      }

      userSubscriptions.delete(subscriptionId);
      return true;
    },

    emptyTrash: async ({ userId }) => {
      const userSubscriptions = getUserMap(userId);
      let deleted = 0;

      for (const [subscriptionId, subscription] of userSubscriptions.entries()) {
        if (subscription.active) {
          continue;
        }

        userSubscriptions.delete(subscriptionId);
        deleted += 1;
      }

      return deleted;
    },

    purgeExpiredTrash: async ({ userId }) => {
      const userSubscriptions = getUserMap(userId);
      const cutoff = nowRef.nowMs() - 14 * DAY_MS;
      let deleted = 0;

      for (const [subscriptionId, subscription] of userSubscriptions.entries()) {
        const deletedAt = subscription.deletedAt?.getTime() ?? 0;
        if (subscription.active || (deletedAt <= cutoff) === false) {
          continue;
        }

        userSubscriptions.delete(subscriptionId);
        deleted += 1;
      }

      return deleted;
    },
  };
};