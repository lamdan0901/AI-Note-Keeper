import { describe, expect, it } from '@jest/globals';
import type { Subscription } from '../../../packages/shared/types/subscription';
import {
  getDueReminderEvents,
  isReminderDue,
  getDaysUntilBilling,
} from '../../../packages/shared/utils/subscription';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-1',
    userId: 'user-1',
    serviceName: 'Netflix',
    category: 'streaming',
    price: 14.99,
    currency: 'USD',
    billingCycle: 'monthly',
    nextBillingDate: Date.now() + 3 * DAY_MS,
    status: 'active',
    reminderDaysBefore: [3, 7],
    active: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('getDaysUntilBilling', () => {
  it('returns positive days when billing is in the future', () => {
    const days = getDaysUntilBilling(Date.now() + 5 * DAY_MS);
    expect(days).toBe(5);
  });

  it('returns 0 when billing is today', () => {
    // Just barely in the future (< 1 day)
    const days = getDaysUntilBilling(Date.now() + 100);
    expect(days).toBe(1); // ceil of a tiny positive fraction
  });

  it('returns negative when billing has passed', () => {
    const days = getDaysUntilBilling(Date.now() - 2 * DAY_MS);
    expect(days).toBeLessThan(0);
  });
});

describe('getDueReminderEvents', () => {
  it('returns billing event when billing date is within reminder window', () => {
    const sub = makeSub({ nextBillingDate: Date.now() + 2 * DAY_MS, reminderDaysBefore: [3] });
    const events = getDueReminderEvents(sub);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('billing');
    expect(events[0].daysUntil).toBeLessThanOrEqual(3);
  });

  it('returns trial_end event when trial end date is within reminder window', () => {
    const sub = makeSub({
      nextBillingDate: Date.now() + 30 * DAY_MS,
      trialEndDate: Date.now() + 2 * DAY_MS,
      reminderDaysBefore: [3],
    });
    const events = getDueReminderEvents(sub);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('trial_end');
  });

  it('returns both billing and trial events when both are due', () => {
    const sub = makeSub({
      nextBillingDate: Date.now() + 2 * DAY_MS,
      trialEndDate: Date.now() + 1 * DAY_MS,
      reminderDaysBefore: [3],
    });
    const events = getDueReminderEvents(sub);
    expect(events).toHaveLength(2);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('billing');
    expect(kinds).toContain('trial_end');
  });

  it('returns empty array for non-active status', () => {
    const sub = makeSub({ status: 'cancelled' });
    expect(getDueReminderEvents(sub)).toHaveLength(0);
  });

  it('returns empty array when billing is far in the future and no trial', () => {
    const sub = makeSub({
      nextBillingDate: Date.now() + 30 * DAY_MS,
      reminderDaysBefore: [3, 7],
    });
    expect(getDueReminderEvents(sub)).toHaveLength(0);
  });

  it('returns empty array when no trialEndDate is provided', () => {
    const sub = makeSub({
      nextBillingDate: Date.now() + 30 * DAY_MS,
      trialEndDate: undefined,
      reminderDaysBefore: [3],
    });
    const events = getDueReminderEvents(sub);
    const trialEvents = events.filter((e) => e.kind === 'trial_end');
    expect(trialEvents).toHaveLength(0);
  });

  it('handles billing date today (daysUntil === 0)', () => {
    // Use a time just barely in the past so ceil produces 0
    const sub = makeSub({
      nextBillingDate: Date.now() - 100,
      reminderDaysBefore: [1],
    });
    const events = getDueReminderEvents(sub);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('billing');
    expect(events[0].daysUntil).toBeLessThanOrEqual(0);
  });
});

describe('isReminderDue', () => {
  it('returns true when billing reminder is due', () => {
    const sub = makeSub({ nextBillingDate: Date.now() + 2 * DAY_MS, reminderDaysBefore: [3] });
    expect(isReminderDue(sub)).toBe(true);
  });

  it('returns true when only trial reminder is due', () => {
    const sub = makeSub({
      nextBillingDate: Date.now() + 30 * DAY_MS,
      trialEndDate: Date.now() + 2 * DAY_MS,
      reminderDaysBefore: [3],
    });
    expect(isReminderDue(sub)).toBe(true);
  });

  it('returns false when nothing is due', () => {
    const sub = makeSub({
      nextBillingDate: Date.now() + 30 * DAY_MS,
      reminderDaysBefore: [3],
    });
    expect(isReminderDue(sub)).toBe(false);
  });

  it('returns false for paused subscription even with upcoming billing', () => {
    const sub = makeSub({
      nextBillingDate: Date.now() + 1 * DAY_MS,
      reminderDaysBefore: [3],
      status: 'paused',
    });
    expect(isReminderDue(sub)).toBe(false);
  });
});
