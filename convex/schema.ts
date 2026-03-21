import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  devicePushTokens: defineTable({
    id: v.string(),
    userId: v.string(),
    deviceId: v.string(),
    fcmToken: v.string(),
    platform: v.string(),
    updatedAt: v.number(),
  }),
  notes: defineTable({
    id: v.string(),
    userId: v.string(),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    contentType: v.optional(v.string()),
    color: v.optional(v.string()),
    active: v.boolean(),
    done: v.optional(v.boolean()),
    isPinned: v.optional(v.boolean()),
    // Reminder fields merged
    triggerAt: v.optional(v.number()),
    repeatRule: v.optional(v.string()), // LEGACY: 'none'|'daily'|'weekly'|'custom'
    repeatConfig: v.optional(v.any()), // LEGACY

    // New standardized repeat rule (JSON object matching RepeatRule type)
    repeat: v.optional(v.any()),

    snoozedUntil: v.optional(v.number()),
    scheduleStatus: v.optional(v.string()), // 'scheduled'|'unscheduled'|'error'
    timezone: v.optional(v.string()), // Reference timezone

    // New fields for robust recurrence
    baseAtLocal: v.optional(v.string()), // ISO string "2026-02-01T09:00"
    startAt: v.optional(v.number()), // Epoch ms anchor
    nextTriggerAt: v.optional(v.number()), // Canonical next fire time
    lastFiredAt: v.optional(v.number()),
    lastAcknowledgedAt: v.optional(v.number()),
    version: v.optional(v.number()), // Optimistic concurrency control
    deletedAt: v.optional(v.number()), // Epoch ms when soft-deleted (for 14-day purge)

    updatedAt: v.number(),
    createdAt: v.number(),
  }),
  noteChangeEvents: defineTable({
    id: v.string(),
    noteId: v.string(),
    userId: v.string(),
    operation: v.string(),
    changedAt: v.number(),
    deviceId: v.string(),
    payloadHash: v.string(),
  }),
  cronState: defineTable({
    key: v.string(), // e.g. 'check-reminders'
    lastCheckedAt: v.number(), // epoch ms watermark
  }),
  subscriptions: defineTable({
    userId: v.string(),
    serviceName: v.string(),
    category: v.string(), // 'streaming'|'music'|'tools'|'productivity'|'gaming'|'news'|'fitness'|'cloud'|'other'
    price: v.number(),
    currency: v.string(), // e.g. 'USD', 'EUR'
    billingCycle: v.string(), // 'weekly'|'monthly'|'yearly'|'custom'
    billingCycleCustomDays: v.optional(v.number()),
    nextBillingDate: v.number(), // epoch ms
    notes: v.optional(v.string()),
    trialEndDate: v.optional(v.number()), // epoch ms
    status: v.string(), // 'active'|'cancelled'|'paused'
    reminderDaysBefore: v.array(v.number()),
    nextReminderAt: v.optional(v.number()), // epoch ms of earliest upcoming reminder
    lastNotifiedBillingDate: v.optional(v.number()), // billing date epoch ms we last notified for
    nextTrialReminderAt: v.optional(v.number()), // epoch ms of earliest upcoming trial-end reminder
    lastNotifiedTrialEndDate: v.optional(v.number()), // trial end date epoch ms we last notified for
    active: v.boolean(), // soft delete flag
    deletedAt: v.optional(v.number()), // epoch ms when soft-deleted (for 14-day purge)
    createdAt: v.number(),
    updatedAt: v.number(),
  }),
});
