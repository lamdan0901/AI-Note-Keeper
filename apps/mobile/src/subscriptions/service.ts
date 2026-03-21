import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import type {
  Subscription,
  SubscriptionCreate,
  SubscriptionUpdate,
} from '../../../../packages/shared/types/subscription';

export const USER_ID = 'local-user';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapDocToMobileSubscription(doc: any): Subscription {
  return {
    id: doc._id as string,
    userId: doc.userId as string,
    serviceName: doc.serviceName as string,
    category: doc.category,
    price: doc.price as number,
    currency: doc.currency as string,
    billingCycle: doc.billingCycle,
    billingCycleCustomDays: doc.billingCycleCustomDays,
    nextBillingDate: doc.nextBillingDate as number,
    notes: doc.notes,
    trialEndDate: doc.trialEndDate,
    status: doc.status,
    reminderDaysBefore: doc.reminderDaysBefore as number[],
    nextReminderAt: doc.nextReminderAt,
    lastNotifiedBillingDate: doc.lastNotifiedBillingDate,
    active: doc.active as boolean,
    createdAt: doc.createdAt as number,
    updatedAt: doc.updatedAt as number,
  };
}

export function useSubscriptions(): Subscription[] | undefined {
  const raw = useQuery(api.functions.subscriptions.listSubscriptions, { userId: USER_ID });
  if (raw === undefined) return undefined;
  return raw.map(mapDocToMobileSubscription);
}

export function useCreateSubscription() {
  return useMutation(api.functions.subscriptions.createSubscription);
}

export function useUpdateSubscription() {
  return useMutation(api.functions.subscriptions.updateSubscription);
}

export function useDeleteSubscription() {
  return useMutation(api.functions.subscriptions.deleteSubscription);
}

type CreateFn = ReturnType<typeof useCreateSubscription>;
type UpdateFn = ReturnType<typeof useUpdateSubscription>;
type DeleteFn = ReturnType<typeof useDeleteSubscription>;

export async function createSubscription(
  mutate: CreateFn,
  data: SubscriptionCreate,
): Promise<void> {
  await mutate({
    userId: data.userId,
    serviceName: data.serviceName,
    category: data.category,
    price: data.price,
    currency: data.currency,
    billingCycle: data.billingCycle,
    billingCycleCustomDays: data.billingCycleCustomDays,
    nextBillingDate: data.nextBillingDate,
    notes: data.notes,
    trialEndDate: data.trialEndDate,
    status: data.status,
    reminderDaysBefore: data.reminderDaysBefore,
  });
}

export async function updateSubscription(
  mutate: UpdateFn,
  id: string,
  patch: SubscriptionUpdate,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await mutate({ id: id as any, patch });
}

export async function deleteSubscription(mutate: DeleteFn, id: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await mutate({ id: id as any });
}
