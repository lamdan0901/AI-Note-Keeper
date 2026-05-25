export const SUBSCRIPTION_REMINDER_DISPATCH_CRON_KEY = 'check-subscription-reminders';

export type SubscriptionReminderKind = 'billing' | 'trial_end';

export type SubscriptionReminderCandidate = Readonly<{
  id: string;
  userId: string;
  serviceName: string;
  price: number;
  currency: string;
  nextBillingDate: Date;
  trialEndDate: Date | null;
  nextReminderAt: Date | null;
  lastNotifiedBillingDate: Date | null;
  nextTrialReminderAt: Date | null;
  lastNotifiedTrialEndDate: Date | null;
  active: boolean;
  status: 'active' | 'paused' | 'canceled';
}>;

export type DueSubscriptionReminder = Readonly<{
  subscriptionId: string;
  userId: string;
  kind: SubscriptionReminderKind;
  triggerTime: Date;
  anchorDate: Date;
  title: string;
  body: string;
}>;

export type SubscriptionReminderScanResult = Readonly<{
  since: Date;
  now: Date;
  reminders: ReadonlyArray<DueSubscriptionReminder>;
}>;

export type SubscriptionReminderScanner = Readonly<{
  scanDueReminders: (input: Readonly<{ now: Date; lastCheckedAt: Date | null }>) => Promise<SubscriptionReminderScanResult>;
}>;

export type SubscriptionReminderDispatchQueueJob = Readonly<{
  subscriptionId: string;
  userId: string;
  kind: SubscriptionReminderKind;
  triggerTime: Date;
  anchorDate: Date;
  eventId: string;
  jobKey: string;
  title: string;
  body: string;
}>;

export type SubscriptionReminderQueueEnqueueResult = Readonly<{
  status: 'enqueued' | 'duplicate';
}>;

export type SubscriptionReminderDispatchQueue = Readonly<{
  enqueue: (job: SubscriptionReminderDispatchQueueJob) => Promise<SubscriptionReminderQueueEnqueueResult>;
}>;

export type SubscriptionReminderStateRepository = Readonly<{
  markBillingReminderSent: (input: Readonly<{ subscriptionId: string; userId: string; anchorDate: Date; triggerTime: Date }>) => Promise<void>;
  markTrialReminderSent: (input: Readonly<{ subscriptionId: string; userId: string; anchorDate: Date; triggerTime: Date }>) => Promise<void>;
}>;

export const createSubscriptionReminderEventId = (
  subscriptionId: string,
  kind: SubscriptionReminderKind,
  triggerTime: Date,
): string => {
  return `subscription-${subscriptionId}-${kind}-${triggerTime.toISOString()}`;
};
