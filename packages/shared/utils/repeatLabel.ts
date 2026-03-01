/**
 * repeatLabel.ts
 *
 * Shared human-readable label formatter for repeat rules.
 * Used by both web and mobile so labels are always identical across platforms.
 */

import { RepeatRule } from '../types/reminder';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Return a short human-readable label for a `RepeatRule`, or `null` for no repeat.
 *
 * Examples:
 *   `{ kind:'daily', interval:1 }`      → "Daily"
 *   `{ kind:'daily', interval:2 }`      → "Every 2 days"
 *   `{ kind:'weekly', interval:1, weekdays:[1,3] }` → "Weekly (Mon, Wed)"
 *   `{ kind:'weekly', interval:2, weekdays:[1] }`   → "Every 2 weeks (Mon)"
 *   `{ kind:'monthly', interval:1 }`    → "Monthly"
 *   `{ kind:'monthly', interval:3 }`    → "Every 3 months"
 *   `{ kind:'custom', interval:30, frequency:'minutes' }` → "Every 30 minutes"
 *   `{ kind:'custom', interval:1, frequency:'days' }`     → "Every 1 day"
 */
export function formatRepeatLabel(repeat: RepeatRule | null): string | null {
  if (!repeat) return null;

  switch (repeat.kind) {
    case 'daily': {
      if (repeat.interval === 1) return 'Daily';
      return `Every ${repeat.interval} days`;
    }

    case 'weekly': {
      const days = repeat.weekdays.map((d) => WEEKDAY_LABELS[d]).join(', ');
      if (repeat.interval === 1) return `Weekly (${days})`;
      return `Every ${repeat.interval} weeks (${days})`;
    }

    case 'monthly': {
      if (repeat.interval === 1) return 'Monthly';
      return `Every ${repeat.interval} months`;
    }

    case 'custom': {
      const { interval, frequency } = repeat;
      switch (frequency) {
        case 'minutes':
          return interval === 1 ? 'Every minute' : `Every ${interval} minutes`;
        case 'days':
          return interval === 1 ? 'Every 1 day' : `Every ${interval} days`;
        case 'weeks':
          return interval === 1 ? 'Every 1 week' : `Every ${interval} weeks`;
        case 'months':
          return interval === 1 ? 'Every 1 month' : `Every ${interval} months`;
      }
    }
  }
}

/**
 * Format a full reminder string including date + repeat label.
 *
 * @param date  The effective trigger date.
 * @param repeat Canonical `RepeatRule` (or null for one-time).
 * @param opts  Formatting options (defaults suit both web and mobile).
 */
export function formatReminderLabel(
  date: Date,
  repeat: RepeatRule | null,
  opts: {
    /** Separator between date and repeat label.  Default: " · " */
    separator?: string;
    /** Wrap repeat label in parentheses.  Default: false */
    wrapParens?: boolean;
    /** Intl.DateTimeFormatOptions for the date portion.  */
    dateFormatOptions?: Intl.DateTimeFormatOptions;
  } = {},
): string {
  const {
    separator = ' · ',
    wrapParens = false,
    dateFormatOptions = {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    },
  } = opts;

  const dateText = new Intl.DateTimeFormat(undefined, dateFormatOptions).format(date);
  const repeatText = formatRepeatLabel(repeat);

  if (!repeatText) return dateText;

  const repeatPart = wrapParens ? `(${repeatText})` : repeatText;
  return `${dateText}${separator}${repeatPart}`;
}
