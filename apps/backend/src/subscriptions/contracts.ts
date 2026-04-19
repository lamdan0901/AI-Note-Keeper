export type BillingCycle = 'weekly' | 'monthly' | 'yearly' | 'custom';

export type SubscriptionStatus = 'active' | 'paused' | 'canceled';

export type SubscriptionRecord = Readonly<{
  id: string;
  userId: string;
  serviceName: string;
  category: string;
  price: number;
  currency: string;
  billingCycle: BillingCycle;
  billingCycleCustomDays: number | null;
  nextBillingDate: Date;
  notes: string | null;
  trialEndDate: Date | null;
  status: SubscriptionStatus;
  reminderDaysBefore: ReadonlyArray<number>;
  nextReminderAt: Date | null;
  lastNotifiedBillingDate: Date | null;
  nextTrialReminderAt: Date | null;
  lastNotifiedTrialEndDate: Date | null;
  active: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type SubscriptionCreateInput = Readonly<{
  userId: string;
  serviceName: string;
  category: string;
  price: number;
  currency: string;
  billingCycle: BillingCycle;
  billingCycleCustomDays: number | null;
  nextBillingDate: Date;
  notes: string | null;
  trialEndDate: Date | null;
  status: SubscriptionStatus;
  reminderDaysBefore: ReadonlyArray<number>;
}>;

export type SubscriptionUpdatePatch = {
  serviceName?: string;
  category?: string;
  price?: number;
  currency?: string;
  billingCycle?: BillingCycle;
  billingCycleCustomDays?: number | null;
  nextBillingDate?: Date;
  notes?: string | null;
  trialEndDate?: Date | null;
  status?: SubscriptionStatus;
  reminderDaysBefore?: ReadonlyArray<number>;
  nextReminderAt?: Date | null;
  nextTrialReminderAt?: Date | null;
  deletedAt?: Date | null;
  active?: boolean;
  updatedAt?: Date;
};

export const toDateOrNull = (value: number | null | undefined): Date | null => {
  if (value === null || value === undefined) {
    return null;
  }

  return new Date(value);
};
