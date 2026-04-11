/**
 * Returns the earliest future reminder timestamp given a billing date and the
 * list of "days before" values. Returns null when no future reminders exist.
 *
 * Local copy for self-contained function deployment — mirrors
 * packages/shared/utils/billing.ts (same pattern as recurrence.ts in reminders-api).
 */
export function computeNextReminderAt(
  nextBillingDate: number,
  reminderDaysBefore: number[],
): number | null {
  const now = Date.now();
  const candidates = reminderDaysBefore
    .map((days) => nextBillingDate - days * 24 * 60 * 60 * 1000)
    .filter((t) => t > now)
    .sort((a, b) => a - b);
  return candidates.length > 0 ? candidates[0] : null;
}

/**
 * Advances a billing date by one billing period.
 */
export function computeAdvancedBillingDate(
  nextBillingDate: number,
  billingCycle: string,
  customDays?: number,
): number {
  const d = new Date(nextBillingDate);
  switch (billingCycle) {
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'yearly':
      d.setFullYear(d.getFullYear() + 1);
      break;
    case 'custom':
      d.setDate(d.getDate() + (customDays ?? 30));
      break;
    case 'monthly':
    default:
      d.setMonth(d.getMonth() + 1);
      break;
  }
  return d.getTime();
}
