export type BillingCycle = 'weekly' | 'monthly' | 'yearly' | 'custom';

export type SubscriptionCategory = string;

export type SubscriptionStatus = 'active' | 'cancelled' | 'paused';

export type Subscription = {
  id: string;
  userId: string;
  serviceName: string;
  category: SubscriptionCategory;
  price: number;
  currency: string;
  billingCycle: BillingCycle;
  billingCycleCustomDays?: number;
  nextBillingDate: number; // epoch ms
  notes?: string;
  trialEndDate?: number; // epoch ms
  status: SubscriptionStatus;
  reminderDaysBefore: number[];
  nextReminderAt?: number; // epoch ms
  lastNotifiedBillingDate?: number; // epoch ms
  active: boolean;
  deletedAt?: number; // epoch ms when moved to trash
  createdAt: number;
  updatedAt: number;
};

export type SubscriptionCreate = Omit<
  Subscription,
  'id' | 'nextReminderAt' | 'lastNotifiedBillingDate' | 'active' | 'createdAt' | 'updatedAt'
>;

export type SubscriptionUpdate = Partial<
  Omit<
    Subscription,
    | 'id'
    | 'userId'
    | 'nextReminderAt'
    | 'lastNotifiedBillingDate'
    | 'active'
    | 'createdAt'
    | 'updatedAt'
  >
>;
