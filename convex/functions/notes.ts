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
        // Reminder fields
        triggerAt: v.optional(v.number()),
        repeatRule: v.optional(v.string()),
        repeatConfig: v.optional(v.any()),
        snoozedUntil: v.optional(v.number()),
        scheduleStatus: v.optional(v.string()),
        timezone: v.optional(v.string()),

        updatedAt: v.number(),
        createdAt: v.number(),
        operation: v.string(), // "create", "update", "delete"
        deviceId: v.string(),
      }),
    ),
    lastSyncAt: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId, changes } = args;

    // Apply specific changes
    for (const change of changes) {
      const { operation, id, ...noteData } = change;

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
          await ctx.db.patch(existing._id, { active: false, updatedAt: noteData.updatedAt });
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
              triggerAt: noteData.triggerAt,
              repeatRule: noteData.repeatRule,
              repeatConfig: noteData.repeatConfig,
              snoozedUntil: noteData.snoozedUntil,
              scheduleStatus: noteData.scheduleStatus,
              timezone: noteData.timezone,
              updatedAt: noteData.updatedAt,
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
            triggerAt: noteData.triggerAt,
            repeatRule: noteData.repeatRule,
            repeatConfig: noteData.repeatConfig,
            snoozedUntil: noteData.snoozedUntil,
            scheduleStatus: noteData.scheduleStatus,
            timezone: noteData.timezone,
            createdAt: noteData.createdAt,
            updatedAt: noteData.updatedAt,
          });
        }
      }
    }

    // Return latest server state for delta sync logic (simplified here to return all)
    // In a real app, we would query noteChangeEvents > lastSyncAt
    // For MVP, just return all notes for the user to replace local state (inefficient but safe)
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
