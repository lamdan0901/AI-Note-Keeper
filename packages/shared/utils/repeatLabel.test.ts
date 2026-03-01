/**
 * repeatLabel.test.ts
 *
 * Unit tests for the shared repeat label formatter.
 */

import { formatRepeatLabel, formatReminderLabel } from './repeatLabel';

describe('formatRepeatLabel', () => {
  it('returns null for null input', () => {
    expect(formatRepeatLabel(null)).toBeNull();
  });

  it('formats daily interval=1 as "Daily"', () => {
    expect(formatRepeatLabel({ kind: 'daily', interval: 1 })).toBe('Daily');
  });

  it('formats daily interval>1 as "Every N days"', () => {
    expect(formatRepeatLabel({ kind: 'daily', interval: 3 })).toBe('Every 3 days');
  });

  it('formats weekly interval=1 with one weekday', () => {
    expect(formatRepeatLabel({ kind: 'weekly', interval: 1, weekdays: [1] })).toBe('Weekly (Mon)');
  });

  it('formats weekly interval=1 with multiple weekdays', () => {
    expect(formatRepeatLabel({ kind: 'weekly', interval: 1, weekdays: [1, 3] })).toBe(
      'Weekly (Mon, Wed)',
    );
  });

  it('formats weekly interval>1', () => {
    expect(formatRepeatLabel({ kind: 'weekly', interval: 2, weekdays: [5] })).toBe(
      'Every 2 weeks (Fri)',
    );
  });

  it('formats monthly interval=1 as "Monthly"', () => {
    expect(formatRepeatLabel({ kind: 'monthly', interval: 1, mode: 'day_of_month' })).toBe(
      'Monthly',
    );
  });

  it('formats monthly interval>1', () => {
    expect(formatRepeatLabel({ kind: 'monthly', interval: 3, mode: 'day_of_month' })).toBe(
      'Every 3 months',
    );
  });

  it('formats custom minutes singular', () => {
    expect(formatRepeatLabel({ kind: 'custom', interval: 1, frequency: 'minutes' })).toBe(
      'Every minute',
    );
  });

  it('formats custom minutes plural', () => {
    expect(formatRepeatLabel({ kind: 'custom', interval: 30, frequency: 'minutes' })).toBe(
      'Every 30 minutes',
    );
  });

  it('formats custom days singular', () => {
    expect(formatRepeatLabel({ kind: 'custom', interval: 1, frequency: 'days' })).toBe(
      'Every 1 day',
    );
  });

  it('formats custom days plural', () => {
    expect(formatRepeatLabel({ kind: 'custom', interval: 5, frequency: 'days' })).toBe(
      'Every 5 days',
    );
  });

  it('formats custom weeks', () => {
    expect(formatRepeatLabel({ kind: 'custom', interval: 2, frequency: 'weeks' })).toBe(
      'Every 2 weeks',
    );
  });

  it('formats custom months', () => {
    expect(formatRepeatLabel({ kind: 'custom', interval: 6, frequency: 'months' })).toBe(
      'Every 6 months',
    );
  });
});

describe('formatReminderLabel', () => {
  const date = new Date('2026-03-02T09:00:00');

  it('returns date-only string when no repeat', () => {
    const result = formatReminderLabel(date, null);
    expect(result).not.toContain('·');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('appends repeat label with separator', () => {
    const result = formatReminderLabel(date, { kind: 'daily', interval: 1 });
    expect(result).toContain(' · ');
    expect(result).toContain('Daily');
  });

  it('respects custom separator', () => {
    const result = formatReminderLabel(date, { kind: 'daily', interval: 1 }, { separator: ' - ' });
    expect(result).toContain(' - Daily');
  });

  it('wraps repeat label in parens when requested', () => {
    const result = formatReminderLabel(date, { kind: 'daily', interval: 1 }, { wrapParens: true });
    expect(result).toContain('(Daily)');
  });

  it('cross-platform: daily label is same regardless of separator', () => {
    const a = formatReminderLabel(date, { kind: 'daily', interval: 2 });
    const b = formatReminderLabel(
      date,
      { kind: 'daily', interval: 2 },
      { separator: ' ', wrapParens: true },
    );
    // Both should contain the same repeat content
    expect(a).toContain('Every 2 days');
    expect(b).toContain('Every 2 days');
  });
});
