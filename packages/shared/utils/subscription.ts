import type { BillingCycle, Subscription } from '../types/subscription';

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

export function computeTotalMonthlyCost(subscriptions: Subscription[]): number {
  return subscriptions
    .filter((subscription) => subscription.status === 'active')
    .reduce(
      (sum, subscription) =>
        sum +
        computeMonthlyCost(
          subscription.price,
          subscription.billingCycle,
          subscription.billingCycleCustomDays,
        ),
      0,
    );
}

export function getDaysUntilBilling(nextBillingDate: number): number {
  const now = Date.now();
  return Math.ceil((nextBillingDate - now) / (24 * 60 * 60 * 1000));
}

export function isReminderDue(subscription: Subscription): boolean {
  if (subscription.status !== 'active') return false;

  const daysUntil = getDaysUntilBilling(subscription.nextBillingDate);
  return subscription.reminderDaysBefore.some((days) => daysUntil >= 0 && daysUntil <= days);
}

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

export function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(price);
  } catch {
    return `${currency} ${price.toFixed(2)}`;
  }
}
