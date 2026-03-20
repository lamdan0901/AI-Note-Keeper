import React, { useState, useCallback } from 'react';
import { LayoutGrid, List, Plus } from 'lucide-react';
import type {
  Subscription,
  SubscriptionCreate,
  SubscriptionUpdate,
} from '../../../../packages/shared/types/subscription';
import {
  useSubscriptions,
  useCreateSubscription,
  useUpdateSubscription,
  useDeleteSubscription,
  createSubscription,
  updateSubscription,
  deleteSubscription,
} from '../services/subscriptions';
import { computeTotalMonthlyCost, formatPrice } from '../services/subscriptionUtils';
import { SubscriptionCard } from '../components/subscriptions/SubscriptionCard';
import { SubscriptionEditorModal } from '../components/subscriptions/SubscriptionEditorModal';

export default function SubscriptionsPage(): JSX.Element {
  const subscriptions = useSubscriptions();
  const createMutate = useCreateSubscription();
  const updateMutate = useUpdateSubscription();
  const deleteMutate = useDeleteSubscription();

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);

  const handleNew = useCallback(() => {
    setEditingSubscription(null);
    setEditorOpen(true);
  }, []);

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

  const list = subscriptions ?? [];
  const filtered = searchQuery.trim()
    ? list.filter((s) => s.serviceName.toLowerCase().includes(searchQuery.toLowerCase()))
    : list;

  const totalMonthly = computeTotalMonthlyCost(list);
  const primaryCurrency = list[0]?.currency ?? 'USD';

  return (
    <div className="subs-page">
      <header className="subs-header">
        <div className="subs-header__search-wrap">
          <input
            className="subs-header__search"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search subscriptions"
            aria-label="Search subscriptions"
          />
        </div>

        <div className="subs-header__actions">
          <div className="subs-header__view-toggle" role="group" aria-label="View mode">
            <button
              className={`subs-header__view-btn${viewMode === 'grid' ? ' subs-header__view-btn--active' : ''}`}
              onClick={() => setViewMode('grid')}
              aria-pressed={viewMode === 'grid'}
              title="Grid view"
              type="button"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              className={`subs-header__view-btn${viewMode === 'list' ? ' subs-header__view-btn--active' : ''}`}
              onClick={() => setViewMode('list')}
              aria-pressed={viewMode === 'list'}
              title="List view"
              type="button"
            >
              <List size={16} />
            </button>
          </div>

          <button className="subs-header__new-btn" onClick={handleNew} type="button">
            <Plus size={16} /> New
          </button>
        </div>
      </header>

      <div className="total-cost">
        {list.length > 0 && (
          <span className="total-cost__total">
            Total: {formatPrice(totalMonthly, primaryCurrency)}/mo
          </span>
        )}
      </div>

      {subscriptions === undefined ? (
        <p className="subs-page__loading">Loading subscriptions…</p>
      ) : filtered.length === 0 ? (
        <p className="subs-page__empty">
          {searchQuery.trim()
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

      {editorOpen && (
        <SubscriptionEditorModal
          subscription={editingSubscription}
          onSave={handleSave}
          onClose={handleClose}
        />
      )}
    </div>
  );
}
