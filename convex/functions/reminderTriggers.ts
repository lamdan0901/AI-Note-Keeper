import { internalAction, internalMutation, internalQuery } from '../_generated/server';
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import { computeNextTrigger } from '../../packages/shared/utils/recurrence';
import type { RepeatRule } from '../../packages/shared/types/reminder';

/** Maximum look-back window (ms) to prevent scanning the entire table
 *  if the cron has been offline for a long time. */
const MAX_LOOKBACK_MS = 5 * 60 * 1000; // 5 minutes

type RepeatConfigShape = {
  kind?: unknown;
  interval?: unknown;
  weekdays?: unknown;
  mode?: unknown;
  frequency?: unknown;
};

type CustomFrequency = 'minutes' | 'days' | 'weeks' | 'months';

const getRepeatRule = (note: {
  repeat?: unknown;
  repeatRule?: unknown;
  repeatConfig?: unknown;
}): RepeatRule | null => {
  if (note.repeat && typeof note.repeat === 'object') {
    return note.repeat as RepeatRule;
  }

  const config = (note.repeatConfig ?? {}) as RepeatConfigShape;
  const kind =
    typeof config.kind === 'string'
      ? config.kind
      : typeof note.repeatRule === 'string'
        ? note.repeatRule
        : undefined;

  const interval = typeof config.interval === 'number' ? config.interval : 1;

  switch (kind) {
    case 'daily':
      return { kind: 'daily', interval };
    case 'weekly': {
      const weekdays = Array.isArray(config.weekdays)
        ? (config.weekdays as number[]).filter((day) => typeof day === 'number')
        : [];
      return { kind: 'weekly', interval, weekdays };
    }
    case 'monthly':
      return {
        kind: 'monthly',
        interval,
        mode: config.mode === 'day_of_month' ? 'day_of_month' : 'day_of_month',
      };
    case 'custom': {
      const frequencyRaw = typeof config.frequency === 'string' ? config.frequency : 'days';
      const frequency = (
        ['minutes', 'days', 'weeks', 'months'].includes(frequencyRaw) ? frequencyRaw : 'days'
      ) as CustomFrequency;
      return { kind: 'custom', interval, frequency };
    }
    default:
      return null;
  }
};

/**
 * Query to find notes with reminders due between a watermark and now.
 * Uses [since, now] instead of a fixed 60-second window so no
 * reminders are missed even when the cron fires slightly late.
 */
export const getDueReminders = internalQuery({
  args: { since: v.number(), now: v.number() },
  handler: async (ctx, { since, now }) => {
    const notes = await ctx.db
      .query('notes')
      .filter((q) =>
        q.and(
          q.eq(q.field('active'), true),
          q.or(
            q.and(
              q.neq(q.field('snoozedUntil'), undefined),
              q.lte(q.field('snoozedUntil'), now),
              q.gte(q.field('snoozedUntil'), since),
            ),
            q.and(
              q.neq(q.field('nextTriggerAt'), undefined),
              q.lte(q.field('nextTriggerAt'), now),
              q.gte(q.field('nextTriggerAt'), since),
            ),
            q.and(
              q.neq(q.field('triggerAt'), undefined),
              q.lte(q.field('triggerAt'), now),
              q.gte(q.field('triggerAt'), since),
            ),
          ),
        ),
      )
      .collect();

    return notes;
  },
});

/**
 * Mark a reminder as triggered so it doesn't fire again.
 */
export const markReminderTriggered = internalMutation({
  args: { noteId: v.string() },
  handler: async (ctx, { noteId }) => {
    const note = await ctx.db
      .query('notes')
      .filter((q) => q.eq(q.field('id'), noteId))
      .first();

    if (note) {
      const now = Date.now();
      const repeat: RepeatRule | null = getRepeatRule(note);
      const startAt: number | null =
        typeof note.startAt === 'number'
          ? note.startAt
          : typeof note.triggerAt === 'number'
            ? note.triggerAt
            : typeof note.nextTriggerAt === 'number'
              ? note.nextTriggerAt
              : null;
      const baseAtLocal: string | null =
        note.baseAtLocal ?? (startAt ? new Date(startAt).toISOString().slice(0, 19) : null);

      let next: number | null = null;

      const hadSnooze = typeof note.snoozedUntil === 'number';
      if (repeat && startAt && baseAtLocal) {
        next = computeNextTrigger(now, startAt, baseAtLocal, repeat);
      }

      const patch: Record<string, unknown> = {
        updatedAt: now,
      };

      if (hadSnooze) {
        patch.snoozedUntil = undefined;
      }

      if (next) {
        patch.nextTriggerAt = next;
        patch.scheduleStatus = 'scheduled';
        patch.active = true;
        patch.lastFiredAt = now;
      } else {
        patch.scheduleStatus = 'unscheduled';
        patch.active = true;
        patch.nextTriggerAt = undefined;
      }

      await ctx.db.patch(note._id, patch);
    }
  },
});

/**
 * Read (and optionally initialise) the cron watermark.
 */
export const getCronWatermark = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    return ctx.db
      .query('cronState')
      .filter((q) => q.eq(q.field('key'), key))
      .first();
  },
});

/**
 * Update the cron watermark after a successful run.
 */
export const updateCronWatermark = internalMutation({
  args: { key: v.string(), lastCheckedAt: v.number() },
  handler: async (ctx, { key, lastCheckedAt }) => {
    const existing = await ctx.db
      .query('cronState')
      .filter((q) => q.eq(q.field('key'), key))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { lastCheckedAt });
    } else {
      await ctx.db.insert('cronState', { key, lastCheckedAt });
    }
  },
});

/**
 * Check for due reminders and send FCM pushes.
 * Called by cron job every minute.
 */
export const checkAndTriggerReminders = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Read the watermark to know where we left off
    const watermark = await ctx.runQuery(internal.functions.reminderTriggers.getCronWatermark, {
      key: 'check-reminders',
    });

    // If no watermark yet, look back at most MAX_LOOKBACK_MS
    const since = watermark ? watermark.lastCheckedAt : now - MAX_LOOKBACK_MS;

    // Get all due reminders in the [since, now] window
    const dueNotes = await ctx.runQuery(internal.functions.reminderTriggers.getDueReminders, {
      since,
      now,
    });

    console.log(
      `[Cron] Found ${dueNotes.length} due reminders ` +
        `(window ${new Date(since).toISOString()} → ${new Date(now).toISOString()})`,
    );

    // Send FCM push for each due reminder
    for (const note of dueNotes) {
      console.log(`[Cron] Triggering reminder for note ${note.id}`);

      try {
        // Use the same eventId format as local alarms for deduplication
        // Local alarm uses: `${reminderId}-${triggerTime}`
        const triggerTime = note.snoozedUntil ?? note.nextTriggerAt ?? note.triggerAt ?? now;
        const eventId = `${note.id}-${triggerTime}`;

        await ctx.runAction(internal.functions.push.sendPush, {
          userId: note.userId,
          reminderId: note.id,
          changeEventId: eventId,
          excludeDeviceId: undefined, // Send to ALL devices
          isTrigger: true,
        });

        // Mark as triggered
        await ctx.runMutation(internal.functions.reminderTriggers.markReminderTriggered, {
          noteId: note.id,
        });

        console.log(`[Cron] Successfully triggered reminder for note ${note.id}`);
      } catch (error) {
        console.error(`[Cron] Failed to trigger reminder for note ${note.id}:`, error);
      }
    }

    // Advance the watermark so the next run picks up from here
    await ctx.runMutation(internal.functions.reminderTriggers.updateCronWatermark, {
      key: 'check-reminders',
      lastCheckedAt: now,
    });
  },
});
