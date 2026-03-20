import React from 'react';
import { Trash2 } from 'lucide-react';
import type { Subscription } from '../../../../../packages/shared/types/subscription';
import {
  getDaysUntilBilling,
  formatBillingCycle,
  formatPrice,
} from '../../services/subscriptionUtils';

interface SubscriptionCardProps {
  subscription: Subscription;
  viewMode: 'grid' | 'list';
  onEdit: () => void;
  onDelete: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  streaming: 'Streaming',
  music: 'Music',
  tools: 'Tools',
  productivity: 'Productivity',
  gaming: 'Gaming',
  news: 'News',
  fitness: 'Fitness',
  cloud: 'Cloud',
  other: 'Other',
};

export function SubscriptionCard({
  subscription,
  viewMode,
  onEdit,
  onDelete,
}: SubscriptionCardProps) {
  const daysUntil = getDaysUntilBilling(subscription.nextBillingDate);

  const nextBillingLabel =
    daysUntil < 0 ? 'Overdue' : daysUntil === 0 ? 'Today' : `${daysUntil}d left`;

  const countdownMod =
    daysUntil < 0 ? 'overdue' : daysUntil <= 3 ? 'urgent' : daysUntil <= 7 ? 'warning' : 'ok';

  const trialDaysLeft =
    subscription.trialEndDate != null ? getDaysUntilBilling(subscription.trialEndDate) : null;

  return (
    <article
      className={`sub-card sub-card--${viewMode} sub-card--${subscription.status}`}
      aria-label={subscription.serviceName}
      onClick={onEdit}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onEdit()}
    >
      <div className="sub-card__actions">
        <button
          className="sub-card__icon-btn sub-card__icon-btn--danger"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label={`Delete ${subscription.serviceName}`}
          title="Delete subscription"
          type="button"
        >
          <Trash2 size={15} />
        </button>
      </div>

      <div className="sub-card__top">
        <span className="sub-card__name">{subscription.serviceName}</span>
        <span
          className={`sub-card__status-dot sub-card__status-dot--${subscription.status}`}
          aria-label={subscription.status}
          title={subscription.status}
        />
      </div>

      <div className="sub-card__badges">
        <span className="sub-card__category">
          {CATEGORY_LABELS[subscription.category] ?? subscription.category}
        </span>
        {subscription.status === 'paused' && (
          <span className="sub-card__badge sub-card__badge--paused">Paused</span>
        )}
        {subscription.status === 'cancelled' && (
          <span className="sub-card__badge sub-card__badge--cancelled">Cancelled</span>
        )}
        {trialDaysLeft != null && trialDaysLeft >= 0 && (
          <span className="sub-card__badge sub-card__badge--trial">
            Trial: {trialDaysLeft}d left
          </span>
        )}
      </div>

      <div className="sub-card__pricing">
        <span className="sub-card__price">
          {formatPrice(subscription.price, subscription.currency)}
        </span>
        <span className="sub-card__cycle">
          {' '}
          / {formatBillingCycle(subscription.billingCycle, subscription.billingCycleCustomDays)}
        </span>
      </div>

      {subscription.status === 'active' && (
        <div className={`sub-card__countdown sub-card__countdown--${countdownMod}`}>
          Next billing: {nextBillingLabel}
        </div>
      )}
    </article>
  );
}
