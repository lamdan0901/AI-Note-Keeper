import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  Subscription,
  SubscriptionCreate,
  SubscriptionUpdate,
} from '../../../../packages/shared/types/subscription';
import { useWebAuth } from '../auth/AuthContext';
import { createWebApiClient } from '../api/httpClient';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Raw API subscription document -> Subscription mapper
// ---------------------------------------------------------------------------

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

const toClientSubscriptionStatus = (value: unknown): Subscription['status'] => {
  if (value === 'paused') {
    return 'paused';
  }

  if (value === 'canceled' || value === 'cancelled') {
    return 'cancelled';
  }

  return 'active';
};

const toApiSubscriptionStatus = (
  value: Subscription['status'],
): 'active' | 'paused' | 'canceled' => {
  if (value === 'cancelled') {
    return 'canceled';
  }

  return value;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapDocToWebSubscription(doc: any): Subscription {
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
    trialEndDate: toEpochMs(doc.trialEndDate) ?? undefined,
    status: toClientSubscriptionStatus(doc.status),
    reminderDaysBefore: doc.reminderDaysBefore as number[],
    nextReminderAt: toEpochMs(doc.nextReminderAt) ?? undefined,
    lastNotifiedBillingDate: toEpochMs(doc.lastNotifiedBillingDate) ?? undefined,
    nextTrialReminderAt: toEpochMs(doc.nextTrialReminderAt) ?? undefined,
    lastNotifiedTrialEndDate: toEpochMs(doc.lastNotifiedTrialEndDate) ?? undefined,
    active: doc.active as boolean,
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

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Returns all active subscriptions for the current user, or `undefined` while loading.
 */
export function useSubscriptions(): Subscription[] | undefined {
  const { getAccessToken, refreshAccessToken } = useWebAuth();
  const [subscriptions, setSubscriptions] = useState<Subscription[] | undefined>(undefined);
  const refreshSignal = useSubscriptionsRefreshSignal();

  const apiClient = useMemo(
    () =>
      createWebApiClient({
        getAccessToken,
        refreshAccessToken,
      }),
    [getAccessToken, refreshAccessToken],
  );

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
          setSubscriptions(response.subscriptions.map((item) => mapDocToWebSubscription(item)));
        }
      } catch {
        if (!cancelled) {
          setSubscriptions([]);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [apiClient, refreshSignal]);

  return subscriptions;
}

export function useDeletedSubscriptions(): Subscription[] | undefined {
  const { getAccessToken, refreshAccessToken } = useWebAuth();
  const [subscriptions, setSubscriptions] = useState<Subscription[] | undefined>(undefined);
  const refreshSignal = useSubscriptionsRefreshSignal();

  const apiClient = useMemo(
    () =>
      createWebApiClient({
        getAccessToken,
        refreshAccessToken,
      }),
    [getAccessToken, refreshAccessToken],
  );

  useEffect(() => {
    let cancelled = false;
    setSubscriptions(undefined);

    const load = async () => {
      try {
        const response = await apiClient.requestJson<
          Readonly<{ subscriptions: ReadonlyArray<unknown> }>
        >('/api/subscriptions/trash');

        if (!cancelled) {
          setSubscriptions(response.subscriptions.map((item) => mapDocToWebSubscription(item)));
        }
      } catch {
        if (!cancelled) {
          setSubscriptions([]);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [apiClient, refreshSignal]);

  return subscriptions;
}

export function useCreateSubscription() {
  const { getAccessToken, refreshAccessToken } = useWebAuth();
  const apiClient = useMemo(
    () =>
      createWebApiClient({
        getAccessToken,
        refreshAccessToken,
      }),
    [getAccessToken, refreshAccessToken],
  );

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
            status: toApiSubscriptionStatus(input.status),
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
  const { getAccessToken, refreshAccessToken } = useWebAuth();
  const apiClient = useMemo(
    () =>
      createWebApiClient({
        getAccessToken,
        refreshAccessToken,
      }),
    [getAccessToken, refreshAccessToken],
  );

  return useCallback(
    async (input: Readonly<{ id: string; patch: SubscriptionUpdate }>): Promise<unknown> => {
      const patchBody = Object.prototype.hasOwnProperty.call(input.patch, 'status')
        ? {
            ...input.patch,
            status:
              input.patch.status === undefined
                ? undefined
                : toApiSubscriptionStatus(input.patch.status),
          }
        : input.patch;

      const response = await apiClient.requestJson<Readonly<{ subscription: unknown }>>(
        `/api/subscriptions/${input.id}`,
        {
          method: 'PATCH',
          body: patchBody,
        },
      );
      notifySubscriptionsRefresh();
      return response;
    },
    [apiClient],
  );
}

export function useDeleteSubscription() {
  const { getAccessToken, refreshAccessToken } = useWebAuth();
  const apiClient = useMemo(
    () =>
      createWebApiClient({
        getAccessToken,
        refreshAccessToken,
      }),
    [getAccessToken, refreshAccessToken],
  );

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
  const { getAccessToken, refreshAccessToken } = useWebAuth();
  const apiClient = useMemo(
    () =>
      createWebApiClient({
        getAccessToken,
        refreshAccessToken,
      }),
    [getAccessToken, refreshAccessToken],
  );

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
  const { getAccessToken, refreshAccessToken } = useWebAuth();
  const apiClient = useMemo(
    () =>
      createWebApiClient({
        getAccessToken,
        refreshAccessToken,
      }),
    [getAccessToken, refreshAccessToken],
  );

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
  const { getAccessToken, refreshAccessToken } = useWebAuth();
  const apiClient = useMemo(
    () =>
      createWebApiClient({
        getAccessToken,
        refreshAccessToken,
      }),
    [getAccessToken, refreshAccessToken],
  );

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

// ---------------------------------------------------------------------------
// Mutation helpers
// ---------------------------------------------------------------------------

type CreateFn = ReturnType<typeof useCreateSubscription>;
type UpdateFn = ReturnType<typeof useUpdateSubscription>;
type DeleteFn = ReturnType<typeof useDeleteSubscription>;
type RestoreFn = ReturnType<typeof useRestoreSubscription>;
type PermanentlyDeleteFn = ReturnType<typeof usePermanentlyDeleteSubscription>;
type EmptyTrashFn = ReturnType<typeof useEmptySubscriptionTrash>;

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

export async function restoreSubscription(mutate: RestoreFn, id: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await mutate({ id: id as any });
}

export async function permanentlyDeleteSubscription(
  mutate: PermanentlyDeleteFn,
  id: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await mutate({ id: id as any });
}

export async function emptySubscriptionTrash(mutate: EmptyTrashFn, userId: string): Promise<void> {
  await mutate({ userId });
}
