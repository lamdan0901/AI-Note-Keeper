import React, { useState, useCallback, useEffect } from 'react';
import { useDebouncedValue } from '../../../../packages/shared/hooks/useDebouncedValue';
import type {
  Subscription,
  SubscriptionCreate,
  SubscriptionUpdate,
} from '../../../../packages/shared/types/subscription';
import {
  useSubscriptions,
  useDeletedSubscriptions,
  useCreateSubscription,
  useUpdateSubscription,
  useDeleteSubscription,
  useRestoreSubscription,
  usePermanentlyDeleteSubscription,
  useEmptySubscriptionTrash,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  restoreSubscription,
  permanentlyDeleteSubscription,
  emptySubscriptionTrash,
} from '../services/subscriptions';
import { computeTotalMonthlyCost, formatPrice } from '../services/subscriptionUtils';
import { SubscriptionCard } from '../components/subscriptions/SubscriptionCard';
import { SubscriptionEditorModal } from '../components/subscriptions/SubscriptionEditorModal';

interface SubscriptionsPageProps {
  viewMode: 'grid' | 'list';
  viewingTrash: boolean;
  searchQuery: string;
  newSubTrigger: number;
  onTrashCountChange: (count: number) => void;
}

export default function SubscriptionsPage({
  viewMode,
  viewingTrash,
  searchQuery,
  newSubTrigger,
  onTrashCountChange,
}: SubscriptionsPageProps): JSX.Element {
  const subscriptions = useSubscriptions();
  const deletedSubscriptions = useDeletedSubscriptions();
  const createMutate = useCreateSubscription();
  const updateMutate = useUpdateSubscription();
  const deleteMutate = useDeleteSubscription();
  const restoreMutate = useRestoreSubscription();
  const permanentlyDeleteMutate = usePermanentlyDeleteSubscription();
  const emptyTrashMutate = useEmptySubscriptionTrash();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 250);

  useEffect(() => {
    if (newSubTrigger > 0) {
      setEditingSubscription(null);
      setEditorOpen(true);
    }
  }, [newSubTrigger]);

  useEffect(() => {
    onTrashCountChange(deletedSubscriptions?.length ?? 0);
  }, [deletedSubscriptions?.length, onTrashCountChange]);

  const handleEdit = useCallback((sub: Subscription) => {
    setEditingSubscription(sub);
    setEditorOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setEditorOpen(false);
  }, []);

  const handleSave = useCallback(
    async (data: SubscriptionCreate | SubscriptionUpdate) => {
      if (editingSubscription) {
        await updateSubscription(updateMutate, editingSubscription.id, data as SubscriptionUpdate);
      } else {
        await createSubscription(createMutate, data as SubscriptionCreate);
      }
      setEditorOpen(false);
    },
    [editingSubscription, createMutate, updateMutate],
  );

  const handleDelete = useCallback(
    async (sub: Subscription) => {
      await deleteSubscription(deleteMutate, sub.id);
    },
    [deleteMutate],
  );

  const handleRestore = useCallback(
    async (sub: Subscription) => {
      await restoreSubscription(restoreMutate, sub.id);
    },
    [restoreMutate],
  );

  const handleDeleteForever = useCallback(
    async (sub: Subscription) => {
      await permanentlyDeleteSubscription(permanentlyDeleteMutate, sub.id);
    },
    [permanentlyDeleteMutate],
  );

  const handleEmptyTrash = useCallback(async () => {
    const count = deletedSubscriptions?.length ?? 0;
    if (count === 0) return;
    if (!window.confirm(`Permanently delete ${count} subscription(s)? This cannot be undone.`)) {
      return;
    }
    await emptySubscriptionTrash(emptyTrashMutate);
  }, [deletedSubscriptions?.length, emptyTrashMutate]);

  const list = subscriptions ?? [];
  const existingCategories = Array.from(
    new Set(
      list.map((item) => item.category.trim()).filter((value): value is string => value.length > 0),
    ),
  );
  const filtered = debouncedSearchQuery.trim()
    ? list.filter((s) => s.serviceName.toLowerCase().includes(debouncedSearchQuery.toLowerCase()))
    : list;

  const trashed = deletedSubscriptions ?? [];
  const filteredTrashed = debouncedSearchQuery.trim()
    ? trashed.filter((s) =>
        s.serviceName.toLowerCase().includes(debouncedSearchQuery.toLowerCase()),
      )
    : trashed;

  const totalMonthly = computeTotalMonthlyCost(list);
  const primaryCurrency = list[0]?.currency ?? 'USD';

  return (
    <div className="subs-page">
      <div className="total-cost">
        {!viewingTrash && list.length > 0 && (
          <span className="total-cost__total">
            Total: {formatPrice(totalMonthly, primaryCurrency)}/mo
          </span>
        )}
      </div>

      {viewingTrash ? (
        <SubscriptionTrashView
          subscriptions={filteredTrashed}
          totalCount={trashed.length}
          searchQuery={debouncedSearchQuery}
          loading={deletedSubscriptions === undefined}
          viewMode={viewMode}
          onRestore={handleRestore}
          onDeleteForever={handleDeleteForever}
          onEmptyTrash={handleEmptyTrash}
        />
      ) : (
        <>
          {subscriptions === undefined ? (
            <p className="subs-page__loading">Loading subscriptions…</p>
          ) : filtered.length === 0 ? (
            <p className="subs-page__empty">
              {debouncedSearchQuery.trim()
                ? 'No subscriptions match your search.'
                : 'No subscriptions yet. Add one to get started.'}
            </p>
          ) : (
            <div className={`subs-list subs-list--${viewMode}`}>
              {filtered.map((sub) => (
                <SubscriptionCard
                  key={sub.id}
                  subscription={sub}
                  viewMode={viewMode}
                  onEdit={() => handleEdit(sub)}
                  onDelete={() => handleDelete(sub)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {editorOpen && (
        <SubscriptionEditorModal
          subscription={editingSubscription}
          existingCategories={existingCategories}
          onSave={handleSave}
          onClose={handleClose}
        />
      )}
    </div>
  );
}

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

function getDaysRemaining(deletedAt: number | undefined, updatedAt: number): number {
  const ref = deletedAt ?? updatedAt;
  const elapsed = Date.now() - ref;
  return Math.max(0, Math.ceil((FOURTEEN_DAYS_MS - elapsed) / (24 * 60 * 60 * 1000)));
}

function SubscriptionTrashView({
  subscriptions,
  totalCount,
  searchQuery,
  loading,
  viewMode,
  onRestore,
  onDeleteForever,
  onEmptyTrash,
}: {
  subscriptions: Subscription[];
  totalCount: number;
  searchQuery: string;
  loading: boolean;
  viewMode: 'grid' | 'list';
  onRestore: (sub: Subscription) => void;
  onDeleteForever: (sub: Subscription) => void;
  onEmptyTrash: () => void;
}): JSX.Element {
  if (loading) {
    return <p className="subs-page__loading">Loading deleted subscriptions…</p>;
  }

  if (subscriptions.length === 0) {
    if (totalCount > 0 && searchQuery.trim().length > 0) {
      return (
        <div className="trash-empty">
          <p className="trash-empty__text">No deleted subscriptions match your search.</p>
        </div>
      );
    }

    return (
      <div className="trash-empty">
        <p className="trash-empty__text">Trash is empty</p>
        <p className="trash-empty__subtext">
          Deleted subscriptions will appear here for 14 days before being permanently removed.
        </p>
      </div>
    );
  }

  return (
    <div className="trash-view">
      <div className="trash-view__toolbar">
        <span className="trash-view__count">
          {subscriptions.length} deleted subscription{subscriptions.length !== 1 ? 's' : ''}
        </span>
        <button className="trash-view__empty-btn" type="button" onClick={onEmptyTrash}>
          Empty Trash
        </button>
      </div>
      <div
        className={
          viewMode === 'grid' ? 'subs-trash-grid' : 'trash-view__list trash-view__list--list'
        }
      >
        {subscriptions.map((sub) => {
          const daysLeft = getDaysRemaining(sub.deletedAt, sub.updatedAt);
          return (
            <div key={sub.id} className="trash-card-slot">
              <div className="trash-card">
                <div className="trash-card__content">
                  <div className="trash-card__title">{sub.serviceName}</div>
                  <div className="trash-card__body">
                    {sub.category && sub.category.trim().length > 0
                      ? `${sub.category} · ${formatPrice(sub.price, sub.currency)}`
                      : formatPrice(sub.price, sub.currency)}
                  </div>
                  <div className="trash-card__meta">
                    {daysLeft === 0
                      ? 'Expiring today'
                      : `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left`}
                  </div>
                </div>
                <div className="trash-card__actions">
                  <button
                    className="trash-card__restore-btn"
                    type="button"
                    onClick={() => onRestore(sub)}
                  >
                    Restore
                  </button>
                  <button
                    className="trash-card__delete-btn"
                    type="button"
                    onClick={() => onDeleteForever(sub)}
                  >
                    Delete Forever
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
