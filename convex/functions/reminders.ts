import { mutation, query } from '../_generated/server';
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import { calculatePayloadHash } from '../../packages/shared/utils/hash';
import { uuidv4 } from '../utils/uuid';
import type { Reminder, RepeatRule } from '../../packages/shared/types/reminder';
import { computeNextTrigger } from '../../packages/shared/utils/recurrence';

const repeatValidator = v.union(
  v.object({ kind: v.literal('daily'), interval: v.number() }),
  v.object({
    kind: v.literal('weekly'),
    interval: v.number(),
    weekdays: v.array(v.number()),
  }),
  v.object({
    kind: v.literal('monthly'),
    interval: v.number(),
    mode: v.literal('day_of_month'),
  }),
  v.object({
    kind: v.literal('custom'),
    interval: v.number(),
    frequency: v.union(
      v.literal('minutes'),
      v.literal('days'),
      v.literal('weeks'),
      v.literal('months'),
    ),
  }),
);

const repeatRuleValue = v.union(
  v.literal('none'),
  v.literal('daily'),
  v.literal('weekly'),
  v.literal('custom'),
);

const scheduleStatusValue = v.union(
  v.literal('scheduled'),
  v.literal('unscheduled'),
  v.literal('error'),
);

export const getReminder = query({
  args: { reminderId: v.string() },
  handler: async (ctx, { reminderId }) => {
    return ctx.db
      .query('notes')
      .filter((q) => q.eq(q.field('id'), reminderId))
      .first();
  },
});

export const listReminders = query({
  args: { updatedSince: v.optional(v.number()) },
  handler: async (ctx, { updatedSince }) => {
    let query = ctx.db.query('notes');
    if (updatedSince !== undefined) {
      query = query.filter((q) => q.gt(q.field('updatedAt'), updatedSince));
    }
    return query.collect();
  },
});

export const createReminder = mutation({
  args: {
    id: v.string(),
    userId: v.string(),
    title: v.optional(v.string()),
    triggerAt: v.number(),
    repeatRule: repeatRuleValue,
    repeatConfig: v.optional(v.any()),
    // New recurrence fields
    repeat: v.optional(repeatValidator),
    startAt: v.optional(v.number()),
    baseAtLocal: v.optional(v.string()),

    snoozedUntil: v.optional(v.number()),
    active: v.boolean(),
    scheduleStatus: v.optional(scheduleStatusValue),
    timezone: v.string(),
    updatedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { deviceId, ...reminderArgs } = args;
    const now = Date.now();

    let nextTriggerAt = reminderArgs.triggerAt;
    // Calculate initial nextTriggerAt if this is a recurring reminder
    if (reminderArgs.repeat && reminderArgs.startAt && reminderArgs.baseAtLocal) {
      const next = computeNextTrigger(
        now,
        reminderArgs.startAt,
        reminderArgs.baseAtLocal,
        reminderArgs.repeat,
      );
      if (next) {
        nextTriggerAt = next;
      }
    }

    const reminder = {
      ...reminderArgs,
      nextTriggerAt, // Set the calculated next trigger
      scheduleStatus: reminderArgs.scheduleStatus ?? 'unscheduled',
      updatedAt: reminderArgs.updatedAt ?? now,
      createdAt: reminderArgs.createdAt ?? now,
    };

    await ctx.db.insert('notes', reminder);

    const changeEventId = await ctx.db.insert('noteChangeEvents', {
      id: uuidv4(),
      noteId: reminder.id,
      userId: reminder.userId,
      operation: 'create',
      changedAt: reminder.updatedAt,
      deviceId: deviceId ?? 'web',
      payloadHash: calculatePayloadHash(reminder as unknown as Reminder),
    });

    await ctx.scheduler.runAfter(0, internal.functions.push.sendPush, {
      userId: reminder.userId,
      excludeDeviceId: deviceId ?? 'web',
      reminderId: reminder.id,
      changeEventId,
    });

    return reminder;
  },
});

export const updateReminder = mutation({
  args: {
    id: v.string(),
    title: v.optional(v.string()),
    triggerAt: v.optional(v.number()),
    repeatRule: v.optional(repeatRuleValue),
    repeatConfig: v.optional(v.any()),
    repeat: v.optional(repeatValidator),
    startAt: v.optional(v.number()),
    baseAtLocal: v.optional(v.string()),
    nextTriggerAt: v.optional(v.number()), // Allow manual override, but we might recalc
    lastFiredAt: v.optional(v.number()),

    snoozedUntil: v.optional(v.number()),
    active: v.optional(v.boolean()),
    scheduleStatus: v.optional(scheduleStatusValue),
    timezone: v.optional(v.string()),
    updatedAt: v.number(),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, { id, deviceId, ...patch }) => {
    const existing = await ctx.db
      .query('notes')
      .filter((q) => q.eq(q.field('id'), id))
      .first();
    if (!existing) {
      return null;
    }
    if (patch.updatedAt <= existing.updatedAt) {
      return existing;
    }
    await ctx.db.patch(existing._id, patch);

    const updated = { ...existing, ...patch };

    const changeEventId = await ctx.db.insert('noteChangeEvents', {
      id: uuidv4(),
      noteId: updated.id,
      userId: updated.userId,
      operation: 'update',
      changedAt: updated.updatedAt,
      deviceId: deviceId ?? 'web',
      payloadHash: calculatePayloadHash(updated as unknown as Reminder),
    });

    await ctx.scheduler.runAfter(0, internal.functions.push.sendPush, {
      userId: updated.userId,
      excludeDeviceId: deviceId ?? 'web',
      reminderId: updated.id,
      changeEventId,
    });

    return updated;
  },
});

export const deleteReminder = mutation({
  args: {
    id: v.string(),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, { id, deviceId }) => {
    const existing = await ctx.db
      .query('notes')
      .filter((q) => q.eq(q.field('id'), id))
      .first();
    if (!existing) {
      return null;
    }
    await ctx.db.delete(existing._id);

    const changeEventId = await ctx.db.insert('noteChangeEvents', {
      id: uuidv4(),
      noteId: existing.id,
      userId: existing.userId,
      operation: 'delete',
      changedAt: Date.now(),
      deviceId: deviceId ?? 'web',
      payloadHash: calculatePayloadHash(existing as unknown as Reminder),
    });

    await ctx.scheduler.runAfter(0, internal.functions.push.sendPush, {
      userId: existing.userId,
      excludeDeviceId: deviceId ?? 'web',
      reminderId: existing.id,
      changeEventId,
    });

    return { id };
  },
});

export const ackReminder = mutation({
  args: {
    id: v.string(),
    ackType: v.union(v.literal('done'), v.literal('snooze')), // snooze handled separately? keeping for extensibility
    optimisticNextTrigger: v.optional(v.number()),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, { id, ackType, deviceId }) => {
    const existing = await ctx.db
      .query('notes')
      .filter((q) => q.eq(q.field('id'), id))
      .first();

    if (!existing) return null;

    const now = Date.now();
    const updates: Record<string, unknown> = {
      updatedAt: now,
      lastAcknowledgedAt: now,
    };

    if (ackType === 'done') {
      updates.done = true;
      const hasRecurrence = !!(existing.repeat && existing.startAt && existing.baseAtLocal);
      if (!hasRecurrence && existing.snoozedUntil && existing.snoozedUntil > now) {
        updates.scheduleStatus = 'scheduled';
        updates.nextTriggerAt = existing.snoozedUntil;
      } else {
        updates.snoozedUntil = undefined;

        // Handle Recurrence
        if (hasRecurrence) {
          const next = computeNextTrigger(
            now,
            existing.startAt,
            existing.baseAtLocal,
            existing.repeat as RepeatRule,
          );

          if (next) {
            updates.nextTriggerAt = next;
            updates.lastFiredAt = now;
            updates.scheduleStatus = 'scheduled';
          } else {
            // Series finished
            updates.scheduleStatus = 'unscheduled';
            updates.nextTriggerAt = undefined;
          }
        } else {
          // One-off reminder completed
          updates.scheduleStatus = 'unscheduled';
          updates.nextTriggerAt = undefined;
        }
      }
    }

    // Apply patch
    await ctx.db.patch(existing._id, updates);

    const updated = { ...existing, ...updates };
    const changeEventId = await ctx.db.insert('noteChangeEvents', {
      id: uuidv4(),
      noteId: updated.id,
      userId: updated.userId,
      operation: 'update',
      changedAt: updated.updatedAt,
      deviceId: deviceId ?? 'web',
      payloadHash: calculatePayloadHash(updated as unknown as Reminder),
    });

    await ctx.scheduler.runAfter(0, internal.functions.push.sendPush, {
      userId: updated.userId,
      excludeDeviceId: deviceId ?? 'web',
      reminderId: updated.id,
      changeEventId,
    });

    return updated;
  },
});

export const snoozeReminder = mutation({
  args: {
    id: v.string(),
    snoozedUntil: v.number(),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, { id, snoozedUntil, deviceId }) => {
    const existing = await ctx.db
      .query('notes')
      .filter((q) => q.eq(q.field('id'), id))
      .first();

    if (!existing) return null;

    const now = Date.now();
    const updates = {
      snoozedUntil,
      updatedAt: now,
      // We don't change `nextTriggerAt` for the series, but snoozing effectively acts as an override
      // The client/notification scheduler should check snoozedUntil first.
      // However, if we want to sort by next occurrence, we might want to update nextTriggerAt?
      // Spec says: "Update snoozedUntil and nextTriggerAt"
      nextTriggerAt: snoozedUntil,
      scheduleStatus: 'scheduled',
      active: true,
    };

    await ctx.db.patch(existing._id, updates);

    const updated = { ...existing, ...updates };
    const changeEventId = await ctx.db.insert('noteChangeEvents', {
      id: uuidv4(),
      noteId: updated.id,
      userId: updated.userId,
      operation: 'update',
      changedAt: updated.updatedAt,
      deviceId: deviceId ?? 'web',
      payloadHash: calculatePayloadHash(updated as unknown as Reminder),
    });

    await ctx.scheduler.runAfter(0, internal.functions.push.sendPush, {
      userId: updated.userId,
      excludeDeviceId: deviceId ?? 'web',
      reminderId: updated.id,
      changeEventId,
    });

    return updated;
  },
});
