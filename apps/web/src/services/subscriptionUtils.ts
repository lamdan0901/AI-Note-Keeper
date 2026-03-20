import type { BillingCycle, Subscription } from '../../../../packages/shared/types/subscription';

// ---------------------------------------------------------------------------
// Cost calculations
// ---------------------------------------------------------------------------

/**
 * Normalizes a subscription price to a monthly equivalent.
 */
export function computeMonthlyCost(
  price: number,
  billingCycle: BillingCycle,
  customDays?: number,
): number {
  switch (billingCycle) {
    case 'weekly':
      return (price * 52) / 12;
    case 'monthly':
      return price;
    case 'yearly':
      return price / 12;
    case 'custom':
      if (!customDays || customDays <= 0) return price;
      return (price * 30) / customDays;
    default:
      return price;
  }
}

/**
 * Sums the monthly-equivalent cost of all active subscriptions.
 */
export function computeTotalMonthlyCost(subscriptions: Subscription[]): number {
  return subscriptions
    .filter((s) => s.status === 'active')
    .reduce(
      (sum, s) => sum + computeMonthlyCost(s.price, s.billingCycle, s.billingCycleCustomDays),
      0,
    );
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Returns the number of whole days until the next billing date (may be negative if overdue).
 */
export function getDaysUntilBilling(nextBillingDate: number): number {
  const now = Date.now();
  return Math.ceil((nextBillingDate - now) / (24 * 60 * 60 * 1000));
}

/**
 * Returns true if today falls within any of the subscription's reminderDaysBefore window.
 */
export function isReminderDue(subscription: Subscription): boolean {
  if (subscription.status !== 'active') return false;
  const daysUntil = getDaysUntilBilling(subscription.nextBillingDate);
  return subscription.reminderDaysBefore.some((days) => daysUntil >= 0 && daysUntil <= days);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable string for a billing cycle.
 */
export function formatBillingCycle(billingCycle: BillingCycle, customDays?: number): string {
  switch (billingCycle) {
    case 'weekly':
      return 'Weekly';
    case 'monthly':
      return 'Monthly';
    case 'yearly':
      return 'Yearly';
    case 'custom':
      return customDays ? `Every ${customDays} days` : 'Custom';
    default:
      return billingCycle;
  }
}

/**
 * Returns a display string for the currency + price, e.g. "$9.99".
 */
export function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(price);
  } catch {
    return `${currency} ${price.toFixed(2)}`;
  }
}
