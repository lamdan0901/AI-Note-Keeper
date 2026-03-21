import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from '../_generated/server';
import { v } from 'convex/values';
import { internal } from '../_generated/api';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the earliest future reminder timestamp given a billing date and the
 * list of "days before" values. Returns null when no future reminders exist.
 */
function computeNextReminderAt(
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
function computeAdvancedBillingDate(
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

// ─── Queries ──────────────────────────────────────────────────────────────────

export const listSubscriptions = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    return ctx.db
      .query('subscriptions')
      .filter((q) => q.and(q.eq(q.field('userId'), userId), q.eq(q.field('active'), true)))
      .collect();
  },
});

export const listDeletedSubscriptions = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const trashed = await ctx.db
      .query('subscriptions')
      .filter((q) => q.and(q.eq(q.field('userId'), userId), q.eq(q.field('active'), false)))
      .collect();

    return trashed.sort((a, b) => (b.deletedAt ?? b.updatedAt) - (a.deletedAt ?? a.updatedAt));
  },
});

export const getSubscription = query({
  args: { id: v.id('subscriptions') },
  handler: async (ctx, { id }) => {
    return ctx.db.get(id);
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

export const createSubscription = mutation({
  args: {
    userId: v.string(),
    serviceName: v.string(),
    category: v.string(),
    price: v.number(),
    currency: v.string(),
    billingCycle: v.string(),
    billingCycleCustomDays: v.optional(v.number()),
    nextBillingDate: v.number(),
    notes: v.optional(v.string()),
    trialEndDate: v.optional(v.number()),
    status: v.string(),
    reminderDaysBefore: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const nextReminderAt =
      computeNextReminderAt(args.nextBillingDate, args.reminderDaysBefore) ?? undefined;
    const nextTrialReminderAt = args.trialEndDate
      ? (computeNextReminderAt(args.trialEndDate, args.reminderDaysBefore) ?? undefined)
      : undefined;
    return ctx.db.insert('subscriptions', {
      ...args,
      nextReminderAt,
      nextTrialReminderAt,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateSubscription = mutation({
  args: {
    id: v.id('subscriptions'),
    patch: v.object({
      serviceName: v.optional(v.string()),
      category: v.optional(v.string()),
      price: v.optional(v.number()),
      currency: v.optional(v.string()),
      billingCycle: v.optional(v.string()),
      billingCycleCustomDays: v.optional(v.number()),
      nextBillingDate: v.optional(v.number()),
      notes: v.optional(v.string()),
      trialEndDate: v.optional(v.number()),
      status: v.optional(v.string()),
      reminderDaysBefore: v.optional(v.array(v.number())),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error(`Subscription ${id} not found`);

    const nextBillingDate = patch.nextBillingDate ?? existing.nextBillingDate;
    const reminderDaysBefore = patch.reminderDaysBefore ?? existing.reminderDaysBefore;
    const nextReminderAt = computeNextReminderAt(nextBillingDate, reminderDaysBefore) ?? undefined;
    const trialEndDate = patch.trialEndDate ?? existing.trialEndDate;
    const nextTrialReminderAt = trialEndDate
      ? (computeNextReminderAt(trialEndDate, reminderDaysBefore) ?? undefined)
      : undefined;

    await ctx.db.patch(id, {
      ...patch,
      nextReminderAt,
      nextTrialReminderAt,
      updatedAt: Date.now(),
    });
  },
});

export const deleteSubscription = mutation({
  args: { id: v.id('subscriptions') },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { active: false, deletedAt: Date.now(), updatedAt: Date.now() });
  },
});

export const restoreSubscription = mutation({
  args: { id: v.id('subscriptions') },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { active: true, deletedAt: undefined, updatedAt: Date.now() });
  },
});

export const permanentlyDeleteSubscription = mutation({
  args: { id: v.id('subscriptions') },
  handler: async (ctx, { id }) => {
    const existing = await ctx.db.get(id);
    if (!existing || existing.active !== false) {
      return { deleted: false };
    }
    await ctx.db.delete(id);
    return { deleted: true };
  },
});

export const emptySubscriptionTrash = mutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const trashed = await ctx.db
      .query('subscriptions')
      .filter((q) => q.and(q.eq(q.field('userId'), userId), q.eq(q.field('active'), false)))
      .collect();

    for (const subscription of trashed) {
      await ctx.db.delete(subscription._id);
    }

    return { deleted: trashed.length };
  },
});

// ─── Internal queries (used by cron) ─────────────────────────────────────────

export const getDueSubscriptionReminders = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    return ctx.db
      .query('subscriptions')
      .filter((q) =>
        q.and(
          q.eq(q.field('active'), true),
          q.eq(q.field('status'), 'active'),
          q.neq(q.field('nextReminderAt'), undefined),
          q.lte(q.field('nextReminderAt'), now),
        ),
      )
      .collect();
  },
});

export const getSubscriptionsWithOverdueBilling = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    return ctx.db
      .query('subscriptions')
      .filter((q) =>
        q.and(
          q.eq(q.field('active'), true),
          q.eq(q.field('status'), 'active'),
          q.lte(q.field('nextBillingDate'), now),
        ),
      )
      .collect();
  },
});

export const getDueTrialReminders = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    return ctx.db
      .query('subscriptions')
      .filter((q) =>
        q.and(
          q.eq(q.field('active'), true),
          q.eq(q.field('status'), 'active'),
          q.neq(q.field('nextTrialReminderAt'), undefined),
          q.lte(q.field('nextTrialReminderAt'), now),
        ),
      )
      .collect();
  },
});

// ─── Internal mutations (used by cron) ───────────────────────────────────────

/**
 * Called after a reminder push fires. Advances billing date if it has passed,
 * then recomputes nextReminderAt for the next reminder in the cycle.
 */
export const advanceSubscriptionAfterReminder = internalMutation({
  args: { id: v.id('subscriptions') },
  handler: async (ctx, { id }) => {
    const sub = await ctx.db.get(id);
    if (!sub) return;

    const now = Date.now();
    let nextBillingDate = sub.nextBillingDate;

    // Advance billing date if it has already passed
    if (nextBillingDate <= now) {
      nextBillingDate = computeAdvancedBillingDate(
        nextBillingDate,
        sub.billingCycle,
        sub.billingCycleCustomDays,
      );
    }

    const nextReminderAt =
      computeNextReminderAt(nextBillingDate, sub.reminderDaysBefore) ?? undefined;

    await ctx.db.patch(id, {
      nextBillingDate,
      nextReminderAt,
      lastNotifiedBillingDate: sub.nextBillingDate,
      updatedAt: now,
    });
  },
});

/**
 * Called after a trial-end reminder push fires. Marks the trial end date as
 * notified and recomputes nextTrialReminderAt for remaining thresholds.
 */
export const advanceSubscriptionAfterTrialReminder = internalMutation({
  args: { id: v.id('subscriptions') },
  handler: async (ctx, { id }) => {
    const sub = await ctx.db.get(id);
    if (!sub || !sub.trialEndDate) return;

    const nextTrialReminderAt =
      computeNextReminderAt(sub.trialEndDate, sub.reminderDaysBefore) ?? undefined;

    await ctx.db.patch(id, {
      nextTrialReminderAt,
      lastNotifiedTrialEndDate: sub.trialEndDate,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Advances an overdue billing date forward until it is in the future, then
 * recomputes nextReminderAt. Used when a billing date passes without a
 * reminder firing (e.g. reminders were disabled or all fired early).
 */
export const advanceBillingSubscription = internalMutation({
  args: { id: v.id('subscriptions') },
  handler: async (ctx, { id }) => {
    const sub = await ctx.db.get(id);
    if (!sub) return;

    const now = Date.now();
    let nextBillingDate = sub.nextBillingDate;

    // Keep advancing until the billing date is in the future
    while (nextBillingDate <= now) {
      nextBillingDate = computeAdvancedBillingDate(
        nextBillingDate,
        sub.billingCycle,
        sub.billingCycleCustomDays,
      );
    }

    const nextReminderAt =
      computeNextReminderAt(nextBillingDate, sub.reminderDaysBefore) ?? undefined;

    await ctx.db.patch(id, { nextBillingDate, nextReminderAt, updatedAt: now });
  },
});

export const purgeExpiredSubscriptionTrash = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - FOURTEEN_DAYS_MS;
    const expired = await ctx.db
      .query('subscriptions')
      .filter((q) =>
        q.and(
          q.eq(q.field('active'), false),
          q.neq(q.field('deletedAt'), undefined),
          q.lt(q.field('deletedAt'), cutoff),
        ),
      )
      .collect();

    for (const subscription of expired) {
      await ctx.db.delete(subscription._id);
    }

    return { purged: expired.length };
  },
});

// ─── Cron handler ─────────────────────────────────────────────────────────────

export const checkSubscriptionReminders = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // 1. Send push notifications for due billing reminders
    const dueSubscriptions = await ctx.runQuery(
      internal.functions.subscriptions.getDueSubscriptionReminders,
      { now },
    );

    console.log(`[SubscriptionCron] Found ${dueSubscriptions.length} due billing reminder(s)`);

    for (const sub of dueSubscriptions) {
      try {
        const msUntilBilling = sub.nextBillingDate - now;
        const daysUntil = Math.ceil(msUntilBilling / (24 * 60 * 60 * 1000));
        const dueLabel =
          daysUntil <= 0 ? 'today' : `in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`;
        const title = `${sub.serviceName} billing ${dueLabel}`;
        const body = `${sub.currency}${sub.price.toFixed(2)} – ${sub.billingCycle}`;

        await ctx.runAction(internal.functions.push.sendSubscriptionPush, {
          userId: sub.userId,
          subscriptionId: sub._id,
          title,
          body,
          reminderKind: 'billing',
        });

        await ctx.runMutation(internal.functions.subscriptions.advanceSubscriptionAfterReminder, {
          id: sub._id,
        });

        console.log(`[SubscriptionCron] Billing notified for ${sub._id} (${sub.serviceName})`);
      } catch (err) {
        console.error(`[SubscriptionCron] Billing failed for ${sub._id}:`, err);
      }
    }

    // 2. Send push notifications for due trial-end reminders
    const dueTrialSubscriptions = await ctx.runQuery(
      internal.functions.subscriptions.getDueTrialReminders,
      { now },
    );

    console.log(`[SubscriptionCron] Found ${dueTrialSubscriptions.length} due trial reminder(s)`);

    for (const sub of dueTrialSubscriptions) {
      try {
        const msUntilTrialEnd = (sub.trialEndDate ?? 0) - now;
        const daysUntil = Math.ceil(msUntilTrialEnd / (24 * 60 * 60 * 1000));
        const dueLabel =
          daysUntil <= 0 ? 'today' : `in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`;
        const title = `${sub.serviceName} trial ends ${dueLabel}`;
        const body = `${sub.currency}${sub.price.toFixed(2)} – ${sub.billingCycle} billing starts after trial`;

        await ctx.runAction(internal.functions.push.sendSubscriptionPush, {
          userId: sub.userId,
          subscriptionId: sub._id,
          title,
          body,
          reminderKind: 'trial_end',
        });

        await ctx.runMutation(
          internal.functions.subscriptions.advanceSubscriptionAfterTrialReminder,
          { id: sub._id },
        );

        console.log(`[SubscriptionCron] Trial notified for ${sub._id} (${sub.serviceName})`);
      } catch (err) {
        console.error(`[SubscriptionCron] Trial failed for ${sub._id}:`, err);
      }
    }

    // 3. Auto-advance billing dates that have passed without any remaining reminders
    const overdueSubscriptions = await ctx.runQuery(
      internal.functions.subscriptions.getSubscriptionsWithOverdueBilling,
      { now },
    );

    for (const sub of overdueSubscriptions) {
      try {
        await ctx.runMutation(internal.functions.subscriptions.advanceBillingSubscription, {
          id: sub._id,
        });
        console.log(
          `[SubscriptionCron] Advanced billing date for subscription ${sub._id} (${sub.serviceName})`,
        );
      } catch (err) {
        console.error(
          `[SubscriptionCron] Failed to advance billing for subscription ${sub._id}:`,
          err,
        );
      }
    }
  },
});
