import type { SubscriptionRecord } from '../../subscriptions/contracts.js';
import {
  createSubscriptionsRepository,
  type SubscriptionsRepository,
} from '../../subscriptions/repositories/subscriptions-repository.js';
import type {
  DueSubscriptionReminder,
  SubscriptionReminderCandidate,
  SubscriptionReminderScanResult,
  SubscriptionReminderScanner,
} from './contracts.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_MS = 5 * 60 * 1000;

const formatPrice = (price: number, currency: string): string => {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${price} ${currency}`.trim();
  }
};

const pluralizeDays = (days: number): string => {
  return days === 1 ? '1 day' : `${days} days`;
};

const computeDaysBefore = (anchorDate: Date, triggerTime: Date): number => {
  const diffMs = anchorDate.getTime() - triggerTime.getTime();
  return Math.max(0, Math.round(diffMs / DAY_MS));
};

const buildReminderText = (
  candidate: SubscriptionReminderCandidate,
  input: Readonly<{ kind: 'billing' | 'trial_end'; triggerTime: Date; anchorDate: Date }>,
): Pick<DueSubscriptionReminder, 'title' | 'body'> => {
  const daysBefore = computeDaysBefore(input.anchorDate, input.triggerTime);
  const priceLabel = formatPrice(candidate.price, candidate.currency);

  if (input.kind === 'trial_end') {
    return {
      title: `${candidate.serviceName} trial ending`,
      body:
        daysBefore === 0
          ? `${candidate.serviceName} trial ends today.`
          : `${candidate.serviceName} trial ends in ${pluralizeDays(daysBefore)}.`,
    };
  }

  return {
    title: `${candidate.serviceName} billing reminder`,
    body:
      daysBefore === 0
        ? `${candidate.serviceName} bills today (${priceLabel}).`
        : `${candidate.serviceName} bills in ${pluralizeDays(daysBefore)} (${priceLabel}).`,
  };
};

const isWithinWindow = (value: Date | null, sinceMs: number, nowMs: number): value is Date => {
  if (!value) {
    return false;
  }

  const ts = value.getTime();
  return ts > sinceMs && ts <= nowMs;
};

const toDueReminders = (
  candidate: SubscriptionReminderCandidate,
  sinceMs: number,
  nowMs: number,
): ReadonlyArray<DueSubscriptionReminder> => {
  const reminders: DueSubscriptionReminder[] = [];

  if (
    candidate.active &&
    candidate.status === 'active' &&
    isWithinWindow(candidate.nextReminderAt, sinceMs, nowMs)
  ) {
    const triggerTime = candidate.nextReminderAt;
    const anchorDate = candidate.nextBillingDate;
    const text = buildReminderText(candidate, { kind: 'billing', triggerTime, anchorDate });
    reminders.push({
      subscriptionId: candidate.id,
      userId: candidate.userId,
      kind: 'billing',
      triggerTime,
      anchorDate,
      title: text.title,
      body: text.body,
    });
  }

  if (
    candidate.active &&
    candidate.status === 'active' &&
    isWithinWindow(candidate.nextTrialReminderAt, sinceMs, nowMs) &&
    candidate.trialEndDate
  ) {
    const triggerTime = candidate.nextTrialReminderAt;
    const anchorDate = candidate.trialEndDate;
    const text = buildReminderText(candidate, { kind: 'trial_end', triggerTime, anchorDate });
    reminders.push({
      subscriptionId: candidate.id,
      userId: candidate.userId,
      kind: 'trial_end',
      triggerTime,
      anchorDate,
      title: text.title,
      body: text.body,
    });
  }

  return reminders;
};

const toCandidate = (subscription: SubscriptionRecord): SubscriptionReminderCandidate => {
  return {
    id: subscription.id,
    userId: subscription.userId,
    serviceName: subscription.serviceName,
    price: subscription.price,
    currency: subscription.currency,
    nextBillingDate: subscription.nextBillingDate,
    trialEndDate: subscription.trialEndDate,
    nextReminderAt: subscription.nextReminderAt,
    lastNotifiedBillingDate: subscription.lastNotifiedBillingDate,
    nextTrialReminderAt: subscription.nextTrialReminderAt,
    lastNotifiedTrialEndDate: subscription.lastNotifiedTrialEndDate,
    active: subscription.active,
    status: subscription.status,
  };
};

export const createSubscriptionReminderScanner = (
  deps: Readonly<{
    subscriptionsRepository?: Pick<SubscriptionsRepository, 'listByUser'>;
    listCandidates?: () => Promise<ReadonlyArray<SubscriptionReminderCandidate>>;
    listUserIds?: () => Promise<ReadonlyArray<string>>;
    lookbackMs?: number;
  }> = {},
): SubscriptionReminderScanner => {
  const subscriptionsRepository = deps.subscriptionsRepository ?? createSubscriptionsRepository();
  const lookbackMs = deps.lookbackMs ?? DEFAULT_LOOKBACK_MS;

  return {
    scanDueReminders: async ({ now, lastCheckedAt }) => {
      const candidates = deps.listCandidates
        ? await deps.listCandidates()
        : deps.listUserIds
          ? (
              await Promise.all(
                (await deps.listUserIds()).map(async (userId) =>
                  (await subscriptionsRepository.listByUser(userId)).map(toCandidate),
                ),
              )
            ).flat()
          : [];
      const resolvedCandidates = candidates;
      const since = lastCheckedAt ?? new Date(now.getTime() - lookbackMs);
      const sinceMs = since.getTime();
      const nowMs = now.getTime();

      const reminders = resolvedCandidates
        .flatMap((candidate) => toDueReminders(candidate, sinceMs, nowMs))
        .sort((left, right) => left.triggerTime.getTime() - right.triggerTime.getTime());

      return {
        since,
        now,
        reminders,
      } satisfies SubscriptionReminderScanResult;
    },
  };
};
