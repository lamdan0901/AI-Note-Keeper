import { mutation, query } from '../_generated/server';
import { v } from 'convex/values';

export const getNotes = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('notes')
      .filter((q) => q.eq(q.field('userId'), args.userId))
      .collect();
  },
});

export const syncNotes = mutation({
  args: {
    userId: v.string(),
    changes: v.array(
      v.object({
        id: v.string(),
        userId: v.string(),
        title: v.optional(v.string()),
        content: v.optional(v.string()),
        color: v.optional(v.string()),
        active: v.boolean(),
        done: v.optional(v.boolean()),
        isPinned: v.optional(v.boolean()),
        // Reminder fields (legacy)
        triggerAt: v.optional(v.number()),
        repeatRule: v.optional(v.string()),
        repeatConfig: v.optional(v.any()),
        snoozedUntil: v.optional(v.number()),
        scheduleStatus: v.optional(v.string()),
        timezone: v.optional(v.string()),

        // Canonical recurrence fields
        repeat: v.optional(v.any()),
        startAt: v.optional(v.union(v.number(), v.null())),
        baseAtLocal: v.optional(v.union(v.string(), v.null())),
        nextTriggerAt: v.optional(v.union(v.number(), v.null())),
        lastFiredAt: v.optional(v.union(v.number(), v.null())),
        lastAcknowledgedAt: v.optional(v.union(v.number(), v.null())),

        updatedAt: v.number(),
        createdAt: v.number(),
        operation: v.string(), // "create", "update", "delete"
        deviceId: v.string(),
        version: v.optional(v.number()),
        baseVersion: v.optional(v.number()),
      }),
    ),
    lastSyncAt: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId, changes } = args;

    // Apply specific changes
    for (const change of changes) {
      const { operation, id, ...noteData } = change;
      const hasCanonicalField = (key: string) =>
        Object.prototype.hasOwnProperty.call(noteData, key);
      const normalizeNullable = <T>(value: T | null | undefined): T | undefined =>
        value === null ? undefined : value;

      // Log change event
      await ctx.db.insert('noteChangeEvents', {
        id: crypto.randomUUID(),
        noteId: id,
        userId,
        operation,
        changedAt: Date.now(),
        deviceId: change.deviceId,
        payloadHash: '', // Simplified for now
      });

      const existing = await ctx.db
        .query('notes')
        .filter((q) => q.eq(q.field('id'), id))
        .first();

      // Conflict Resolution: Last Write Wins (based on updatedAt usually, but here simple overwrite)
      if (operation === 'delete') {
        if (existing) {
          // Soft delete
          await ctx.db.patch(existing._id, {
            active: false,
            updatedAt: noteData.updatedAt,
            version: (existing.version || 0) + 1,
          });
        }
      } else {
        if (existing) {
          if (noteData.updatedAt > existing.updatedAt) {
            await ctx.db.patch(existing._id, {
              title: noteData.title,
              content: noteData.content,
              color: noteData.color,
              active: noteData.active,
              done: noteData.done,
              isPinned: noteData.isPinned,
              triggerAt: noteData.triggerAt,
              repeatRule: noteData.repeatRule,
              repeatConfig: noteData.repeatConfig,
              snoozedUntil: noteData.snoozedUntil,
              scheduleStatus: noteData.scheduleStatus,
              timezone: noteData.timezone,
              // Canonical recurrence — only patch when explicitly provided
              ...(hasCanonicalField('repeat') && {
                repeat: normalizeNullable(noteData.repeat),
              }),
              ...(hasCanonicalField('startAt') && {
                startAt: normalizeNullable(noteData.startAt),
              }),
              ...(hasCanonicalField('baseAtLocal') && {
                baseAtLocal: normalizeNullable(noteData.baseAtLocal),
              }),
              ...(hasCanonicalField('nextTriggerAt') && {
                nextTriggerAt: normalizeNullable(noteData.nextTriggerAt),
              }),
              ...(hasCanonicalField('lastFiredAt') && {
                lastFiredAt: normalizeNullable(noteData.lastFiredAt),
              }),
              ...(hasCanonicalField('lastAcknowledgedAt') && {
                lastAcknowledgedAt: normalizeNullable(noteData.lastAcknowledgedAt),
              }),
              updatedAt: noteData.updatedAt,
              version: (existing.version || 0) + 1,
            });
          }
        } else {
          await ctx.db.insert('notes', {
            id,
            userId,
            title: noteData.title,
            content: noteData.content,
            color: noteData.color,
            active: noteData.active,
            done: noteData.done,
            isPinned: noteData.isPinned,
            triggerAt: noteData.triggerAt,
            repeatRule: noteData.repeatRule,
            repeatConfig: noteData.repeatConfig,
            snoozedUntil: noteData.snoozedUntil,
            scheduleStatus: noteData.scheduleStatus,
            timezone: noteData.timezone,
            // Canonical recurrence
            repeat: normalizeNullable(noteData.repeat),
            startAt: normalizeNullable(noteData.startAt),
            baseAtLocal: normalizeNullable(noteData.baseAtLocal),
            nextTriggerAt: normalizeNullable(noteData.nextTriggerAt),
            lastFiredAt: normalizeNullable(noteData.lastFiredAt),
            lastAcknowledgedAt: normalizeNullable(noteData.lastAcknowledgedAt),
            createdAt: noteData.createdAt,
            updatedAt: noteData.updatedAt,
            version: 1,
          });
        }
      }
    }

    // Return latest server state for delta sync logic (simplified here to return all)
    const allNotes = await ctx.db
      .query('notes')
      .filter((q) => q.eq(q.field('userId'), userId))
      .collect();

    return {
      notes: allNotes,
      syncedAt: Date.now(),
    };
  },
});
