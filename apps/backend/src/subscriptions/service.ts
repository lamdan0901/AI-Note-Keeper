import { AppError } from '../middleware/error-middleware.js';
import {
  createSubscriptionsRepository,
  type SubscriptionsRepository,
} from './repositories/subscriptions-repository.js';
import type {
  SubscriptionCreateInput,
  SubscriptionRecord,
  SubscriptionUpdatePatch,
} from './contracts.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const TRASH_RETENTION_MS = 14 * DAY_MS;

type SubscriptionsServiceDeps = Readonly<{
  subscriptionsRepository?: SubscriptionsRepository;
  now?: () => Date;
}>;

export type SubscriptionsService = Readonly<{
  list: (input: Readonly<{ userId: string }>) => Promise<ReadonlyArray<SubscriptionRecord>>;
  create: (input: SubscriptionCreateInput) => Promise<SubscriptionRecord>;
  update: (input: Readonly<{ subscriptionId: string; userId: string; patch: SubscriptionUpdatePatch }>) => Promise<SubscriptionRecord>;
  trash: (input: Readonly<{ subscriptionId: string; userId: string }>) => Promise<boolean>;
  restore: (input: Readonly<{ subscriptionId: string; userId: string }>) => Promise<boolean>;
  permanentlyDelete: (input: Readonly<{ subscriptionId: string; userId: string }>) => Promise<boolean>;
  purgeExpiredTrash: (input: Readonly<{ userId: string }>) => Promise<number>;
}>;

const computeNextReminderAt = (
  anchorDate: Date,
  reminderDaysBefore: ReadonlyArray<number>,
  nowMs: number,
): Date | null => {
  const candidates = reminderDaysBefore
    .map((daysBefore) => anchorDate.getTime() - daysBefore * DAY_MS)
    .filter((candidate) => candidate > nowMs)
    .sort((left, right) => left - right);

  if (candidates.length === 0) {
    return null;
  }

  return new Date(candidates[0]);
};

const toNotFoundError = (): AppError => {
  return new AppError({
    code: 'not_found',
    message: 'Subscription not found',
  });
};

export const createSubscriptionsService = (
  deps: SubscriptionsServiceDeps = {},
): SubscriptionsService => {
  const subscriptionsRepository = deps.subscriptionsRepository ?? createSubscriptionsRepository();
  const now = deps.now ?? (() => new Date());

  const attachDerivedFields = <T extends Readonly<{
    nextBillingDate: Date;
    trialEndDate: Date | null;
    reminderDaysBefore: ReadonlyArray<number>;
  }>>(input: T): T & Readonly<{ nextReminderAt: Date | null; nextTrialReminderAt: Date | null }> => {
    const nowMs = now().getTime();
    const nextReminderAt = computeNextReminderAt(input.nextBillingDate, input.reminderDaysBefore, nowMs);
    const nextTrialReminderAt = input.trialEndDate
      ? computeNextReminderAt(input.trialEndDate, input.reminderDaysBefore, nowMs)
      : null;

    return {
      ...input,
      nextReminderAt,
      nextTrialReminderAt,
    };
  };

  return {
    list: async ({ userId }) => {
      return await subscriptionsRepository.listByUser(userId);
    },

    create: async (input) => {
      const withDerived = attachDerivedFields(input);
      const created = await subscriptionsRepository.create(input);

      const updated = await subscriptionsRepository.patch({
        subscriptionId: created.id,
        userId: created.userId,
        patch: {
          nextReminderAt: withDerived.nextReminderAt,
          nextTrialReminderAt: withDerived.nextTrialReminderAt,
          updatedAt: now(),
        },
      });

      if (!updated) {
        throw toNotFoundError();
      }

      return updated;
    },

    update: async ({ subscriptionId, userId, patch }) => {
      const existing = await subscriptionsRepository.findByIdForUser({ subscriptionId, userId });
      if (!existing) {
        throw toNotFoundError();
      }

      const merged = {
        nextBillingDate: patch.nextBillingDate ?? existing.nextBillingDate,
        trialEndDate:
          Object.hasOwn(patch, 'trialEndDate') ? patch.trialEndDate ?? null : existing.trialEndDate,
        reminderDaysBefore: patch.reminderDaysBefore ?? existing.reminderDaysBefore,
      };

      const withDerived = attachDerivedFields(merged);
      const updated = await subscriptionsRepository.patch({
        subscriptionId,
        userId,
        patch: {
          ...patch,
          nextReminderAt: withDerived.nextReminderAt,
          nextTrialReminderAt: withDerived.nextTrialReminderAt,
          updatedAt: now(),
        },
      });

      if (!updated) {
        throw toNotFoundError();
      }

      return updated;
    },

    trash: async ({ subscriptionId, userId }) => {
      const existing = await subscriptionsRepository.findByIdForUser({ subscriptionId, userId });
      if (!existing) {
        return false;
      }

      const trashed = await subscriptionsRepository.patch({
        subscriptionId,
        userId,
        patch: {
          active: false,
          deletedAt: now(),
          updatedAt: now(),
        },
      });

      return Boolean(trashed);
    },

    restore: async ({ subscriptionId, userId }) => {
      const existing = await subscriptionsRepository.findByIdForUser({ subscriptionId, userId });
      if (!existing) {
        return false;
      }

      const restored = await subscriptionsRepository.patch({
        subscriptionId,
        userId,
        patch: {
          active: true,
          deletedAt: null,
          updatedAt: now(),
        },
      });

      return Boolean(restored);
    },

    permanentlyDelete: async ({ subscriptionId, userId }) => {
      const existing = await subscriptionsRepository.findByIdForUser({ subscriptionId, userId });
      if (!existing || existing.active) {
        return false;
      }

      return await subscriptionsRepository.hardDelete({ subscriptionId, userId });
    },

    purgeExpiredTrash: async ({ userId }) => {
      const trashed = await subscriptionsRepository.listTrashedByUser(userId);
      const cutoff = now().getTime() - TRASH_RETENTION_MS;
      let purged = 0;

      for (const subscription of trashed) {
        const deletedAt = subscription.deletedAt?.getTime() ?? 0;
        if (deletedAt <= 0 || deletedAt > cutoff) {
          continue;
        }

        const deleted = await subscriptionsRepository.hardDelete({
          subscriptionId: subscription.id,
          userId,
        });

        if (deleted) {
          purged += 1;
        }
      }

      return purged;
    },
  };
};
