import React, { useState } from 'react';
import { Bell, X } from 'lucide-react';
import type { Subscription } from '../../../../../packages/shared/types/subscription';
import { getDueReminderEvents, formatPrice } from '../../services/subscriptionUtils';
import type { DueReminderEvent } from '../../services/subscriptionUtils';

const DISMISSED_REMINDERS_STORAGE_KEY = 'sub-reminder-banner-dismissed-v1';
const DISMISSED_REMINDERS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function extractEventDateFromReminderKey(key: string): number | null {
  const lastDashIndex = key.lastIndexOf('-');
  if (lastDashIndex === -1) return null;

  const rawDate = key.slice(lastDashIndex + 1);
  if (!/^\d+$/.test(rawDate)) return null;

  const eventDate = Number(rawDate);
  if (!Number.isFinite(eventDate)) return null;
  return eventDate;
}

function pruneDismissedReminderKeys(keys: Set<string>): Set<string> {
  const minAllowedDate = Date.now() - DISMISSED_REMINDERS_RETENTION_MS;
  const next = new Set<string>();

  for (const key of keys) {
    const eventDate = extractEventDateFromReminderKey(key);
    if (eventDate == null) continue;
    if (eventDate >= minAllowedDate) next.add(key);
  }

  return next;
}

function readDismissedReminders(): Set<string> {
  if (typeof window === 'undefined') return new Set();

  try {
    const raw = window.localStorage.getItem(DISMISSED_REMINDERS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const parsedSet = new Set(parsed.filter((item): item is string => typeof item === 'string'));
    const prunedSet = pruneDismissedReminderKeys(parsedSet);

    if (prunedSet.size !== parsedSet.size) {
      writeDismissedReminders(prunedSet);
    }

    return prunedSet;
  } catch {
    return new Set();
  }
}

function writeDismissedReminders(keys: Set<string>) {
  if (typeof window === 'undefined') return;

  try {
    const prunedKeys = pruneDismissedReminderKeys(keys);
    window.localStorage.setItem(
      DISMISSED_REMINDERS_STORAGE_KEY,
      JSON.stringify(Array.from(prunedKeys)),
    );
  } catch {
    // Ignore storage write failures and keep current in-memory dismissal state.
  }
}

function toReminderKey(subscription: Subscription, event: DueReminderEvent): string {
  const eventDate =
    event.kind === 'billing' ? subscription.nextBillingDate : subscription.trialEndDate;
  return `${subscription.id}-${event.kind}-${eventDate ?? 'none'}`;
}

interface SubscriptionReminderBannerProps {
  subscriptions: Subscription[];
}

type ReminderChip = {
  subscription: Subscription;
  event: DueReminderEvent;
  key: string;
};

export function SubscriptionReminderBanner({ subscriptions }: SubscriptionReminderBannerProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissedReminders());

  const chips: ReminderChip[] = [];
  for (const s of subscriptions) {
    const events = getDueReminderEvents(s);
    for (const event of events) {
      const key = toReminderKey(s, event);
      if (!dismissed.has(key)) {
        chips.push({ subscription: s, event, key });
      }
    }
  }

  if (chips.length === 0) return null;

  const dismiss = (key: string) =>
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(key);
      writeDismissedReminders(next);
      return next;
    });

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
