import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  Subscription,
  SubscriptionCreate,
  SubscriptionUpdate,
} from '../../../../packages/shared/types/subscription';
import { createDefaultMobileApiClient } from '../api/httpClient';
import { useUserId } from '../auth/useUserId';

const toEpochMs = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapDocToMobileSubscription(doc: any): Subscription {
  return {
    id: String(doc.id ?? doc._id),
    userId: String(doc.userId),
    serviceName: String(doc.serviceName),
    category: doc.category,
    price: Number(doc.price),
    currency: String(doc.currency),
    billingCycle: doc.billingCycle,
    billingCycleCustomDays: doc.billingCycleCustomDays,
    nextBillingDate: toEpochMs(doc.nextBillingDate) ?? Date.now(),
    notes: doc.notes,
    trialEndDate: toEpochMs(doc.trialEndDate),
    status: doc.status,
    reminderDaysBefore: doc.reminderDaysBefore as number[],
    nextReminderAt: toEpochMs(doc.nextReminderAt),
    lastNotifiedBillingDate: toEpochMs(doc.lastNotifiedBillingDate),
    nextTrialReminderAt: toEpochMs(doc.nextTrialReminderAt),
    lastNotifiedTrialEndDate: toEpochMs(doc.lastNotifiedTrialEndDate),
    active: Boolean(doc.active),
    deletedAt: toEpochMs(doc.deletedAt) ?? undefined,
    createdAt: toEpochMs(doc.createdAt) ?? Date.now(),
    updatedAt: toEpochMs(doc.updatedAt) ?? Date.now(),
  };
}

const subscriptionsRefreshListeners = new Set<() => void>();

const subscribeToSubscriptionsRefresh = (listener: () => void): (() => void) => {
  subscriptionsRefreshListeners.add(listener);
  return () => {
    subscriptionsRefreshListeners.delete(listener);
  };
};

const notifySubscriptionsRefresh = (): void => {
  for (const listener of subscriptionsRefreshListeners) {
    listener();
  }
};

const useSubscriptionsRefreshSignal = (): number => {
  const [signal, setSignal] = useState(0);

  useEffect(() => {
    return subscribeToSubscriptionsRefresh(() => {
      setSignal((previousSignal) => previousSignal + 1);
    });
  }, []);

  return signal;
};

export function useSubscriptions(): Subscription[] | undefined {
  const userId = useUserId();
  const [subscriptions, setSubscriptions] = useState<Subscription[] | undefined>(undefined);
  const refreshSignal = useSubscriptionsRefreshSignal();

  const apiClient = useMemo(() => createDefaultMobileApiClient(), []);

  useEffect(() => {
    let cancelled = false;
    setSubscriptions(undefined);

    const load = async () => {
      try {
        const response =
          await apiClient.requestJson<Readonly<{ subscriptions: ReadonlyArray<unknown> }>>(
            '/api/subscriptions',
          );

        if (!cancelled) {
          setSubscriptions(response.subscriptions.map((item) => mapDocToMobileSubscription(item)));
        }
      } catch {
        if (!cancelled) {
          setSubscriptions([]);
        }
      }
    };

    if (!userId) {
      setSubscriptions([]);
      return;
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [apiClient, refreshSignal, userId]);

  return subscriptions;
}

export function useDeletedSubscriptions(enabled = true): Subscription[] | undefined {
  const userId = useUserId();
  const [subscriptions, setSubscriptions] = useState<Subscription[] | undefined>(undefined);
  const refreshSignal = useSubscriptionsRefreshSignal();

  const apiClient = useMemo(() => createDefaultMobileApiClient(), []);

  useEffect(() => {
    if (!enabled) {
      setSubscriptions([]);
      return;
    }

    let cancelled = false;
    setSubscriptions(undefined);

    const load = async () => {
      try {
        const response = await apiClient.requestJson<
          Readonly<{ subscriptions: ReadonlyArray<unknown> }>
        >('/api/subscriptions/trash');

        if (!cancelled) {
          setSubscriptions(response.subscriptions.map((item) => mapDocToMobileSubscription(item)));
        }
      } catch {
        if (!cancelled) {
          setSubscriptions([]);
        }
      }
    };

    if (!userId) {
      setSubscriptions([]);
      return;
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [apiClient, enabled, refreshSignal, userId]);

  return subscriptions;
}

export function useCreateSubscription() {
  const apiClient = useMemo(() => createDefaultMobileApiClient(), []);

  return useCallback(
    async (input: SubscriptionCreate): Promise<Readonly<{ subscription: unknown }>> => {
      const response = await apiClient.requestJson<Readonly<{ subscription: unknown }>>(
        '/api/subscriptions',
        {
          method: 'POST',
          body: {
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
            reminderDaysBefore: input.reminderDaysBefore,
          },
        },
      );
      notifySubscriptionsRefresh();
      return response;
    },
    [apiClient],
  );
}

export function useUpdateSubscription() {
  const apiClient = useMemo(() => createDefaultMobileApiClient(), []);

  return useCallback(
    async (input: Readonly<{ id: string; patch: SubscriptionUpdate }>): Promise<unknown> => {
      const response = await apiClient.requestJson<Readonly<{ subscription: unknown }>>(
        `/api/subscriptions/${input.id}`,
        {
          method: 'PATCH',
          body: input.patch,
        },
      );
      notifySubscriptionsRefresh();
      return response;
    },
    [apiClient],
  );
}

export function useDeleteSubscription() {
  const apiClient = useMemo(() => createDefaultMobileApiClient(), []);

  return useCallback(
    async (input: Readonly<{ id: string }>): Promise<Readonly<{ deleted: boolean }>> => {
      const response = await apiClient.requestJson<Readonly<{ deleted: boolean }>>(
        `/api/subscriptions/${input.id}`,
        {
          method: 'DELETE',
        },
      );
      notifySubscriptionsRefresh();
      return response;
    },
    [apiClient],
  );
}

export function useRestoreSubscription() {
  const apiClient = useMemo(() => createDefaultMobileApiClient(), []);

  return useCallback(
    async (input: Readonly<{ id: string }>): Promise<Readonly<{ restored: boolean }>> => {
      const response = await apiClient.requestJson<Readonly<{ restored: boolean }>>(
        `/api/subscriptions/${input.id}/restore`,
        {
          method: 'POST',
        },
      );
      notifySubscriptionsRefresh();
      return response;
    },
    [apiClient],
  );
}

export function usePermanentlyDeleteSubscription() {
  const apiClient = useMemo(() => createDefaultMobileApiClient(), []);

  return useCallback(
    async (input: Readonly<{ id: string }>): Promise<Readonly<{ deleted: boolean }>> => {
      const response = await apiClient.requestJson<Readonly<{ deleted: boolean }>>(
        `/api/subscriptions/${input.id}/permanent`,
        {
          method: 'DELETE',
        },
      );
      notifySubscriptionsRefresh();
      return response;
    },
    [apiClient],
  );
}

export function useEmptySubscriptionTrash() {
  const apiClient = useMemo(() => createDefaultMobileApiClient(), []);

  return useCallback(
    async (input?: Readonly<{ userId?: string }>): Promise<Readonly<{ deleted: number }>> => {
      void input;
      const response = await apiClient.requestJson<Readonly<{ deleted: number }>>(
        '/api/subscriptions/trash/empty',
        {
          method: 'DELETE',
        },
      );
      notifySubscriptionsRefresh();
      return response;
    },
    [apiClient],
  );
}

type CreateFn = ReturnType<typeof useCreateSubscription>;
type UpdateFn = ReturnType<typeof useUpdateSubscription>;
type DeleteFn = ReturnType<typeof useDeleteSubscription>;
type RestoreFn = ReturnType<typeof useRestoreSubscription>;
type DeleteForeverFn = ReturnType<typeof usePermanentlyDeleteSubscription>;
type EmptyTrashFn = ReturnType<typeof useEmptySubscriptionTrash>;

export async function createSubscription(
  mutate: CreateFn,
  data: SubscriptionCreate,
): Promise<string> {
  const response = await mutate(data);
  const raw = response.subscription as { id?: string; _id?: string };
  const createdId = raw.id ?? raw._id;
  if (!createdId) {
    throw new Error('Subscription create response missing id');
  }
  return String(createdId);
}

export async function updateSubscription(
  mutate: UpdateFn,
  id: string,
  patch: SubscriptionUpdate,
): Promise<void> {
  await mutate({ id, patch });
}

export async function deleteSubscription(mutate: DeleteFn, id: string): Promise<void> {
  await mutate({ id });
}

export async function restoreSubscription(mutate: RestoreFn, id: string): Promise<void> {
  await mutate({ id });
}

export async function permanentlyDeleteSubscription(
  mutate: DeleteForeverFn,
  id: string,
): Promise<void> {
  await mutate({ id });
}

export async function emptySubscriptionTrash(mutate: EmptyTrashFn, _userId: string): Promise<void> {
  void _userId;
  await mutate();
}
