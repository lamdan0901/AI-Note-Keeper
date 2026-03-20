import React, { useState } from 'react';
import { Bell, X } from 'lucide-react';
import type { Subscription } from '../../../../../packages/shared/types/subscription';
import { isReminderDue, getDaysUntilBilling, formatPrice } from '../../services/subscriptionUtils';

interface SubscriptionReminderBannerProps {
  subscriptions: Subscription[];
}

export function SubscriptionReminderBanner({ subscriptions }: SubscriptionReminderBannerProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const due = subscriptions.filter((s) => isReminderDue(s) && !dismissed.has(s.id));

  if (due.length === 0) return null;

  const dismiss = (id: string) => setDismissed((prev) => new Set([...prev, id]));

  return (
    <div className="sub-reminder-banner" role="alert" aria-live="polite">
      <Bell size={16} className="sub-reminder-banner__icon" aria-hidden="true" />
      <div className="sub-reminder-banner__items">
        {due.map((s) => {
          const days = getDaysUntilBilling(s.nextBillingDate);
          const when = days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`;
          return (
            <span key={s.id} className="sub-reminder-banner__chip">
              <strong>{s.serviceName}</strong> billing {when} ({formatPrice(s.price, s.currency)})
              <button
                className="sub-reminder-banner__dismiss"
                onClick={() => dismiss(s.id)}
                aria-label={`Dismiss reminder for ${s.serviceName}`}
                type="button"
              >
                <X size={12} />
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
