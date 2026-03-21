import React, { useState } from 'react';
import { Bell, X } from 'lucide-react';
import type { Subscription } from '../../../../../packages/shared/types/subscription';
import { getDueReminderEvents, formatPrice } from '../../services/subscriptionUtils';
import type { DueReminderEvent } from '../../services/subscriptionUtils';

interface SubscriptionReminderBannerProps {
  subscriptions: Subscription[];
}

type ReminderChip = {
  subscription: Subscription;
  event: DueReminderEvent;
  key: string;
};

export function SubscriptionReminderBanner({ subscriptions }: SubscriptionReminderBannerProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const chips: ReminderChip[] = [];
  for (const s of subscriptions) {
    const events = getDueReminderEvents(s);
    for (const event of events) {
      const key = `${s.id}-${event.kind}`;
      if (!dismissed.has(key)) {
        chips.push({ subscription: s, event, key });
      }
    }
  }

  if (chips.length === 0) return null;

  const dismiss = (key: string) => setDismissed((prev) => new Set([...prev, key]));

  return (
    <div className="sub-reminder-banner" role="alert" aria-live="polite">
      <Bell size={16} className="sub-reminder-banner__icon" aria-hidden="true" />
      <div className="sub-reminder-banner__items">
        {chips.map(({ subscription: s, event, key }) => {
          const when =
            event.daysUntil === 0
              ? 'today'
              : `in ${event.daysUntil} day${event.daysUntil === 1 ? '' : 's'}`;
          const label = event.kind === 'trial_end' ? `trial ends ${when}` : `billing ${when}`;
          return (
            <span key={key} className="sub-reminder-banner__chip">
              <strong>{s.serviceName}</strong> {label} ({formatPrice(s.price, s.currency)})
              <button
                className="sub-reminder-banner__dismiss"
                onClick={() => dismiss(key)}
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
