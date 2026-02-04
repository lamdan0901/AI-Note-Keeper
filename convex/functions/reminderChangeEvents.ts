import { mutation, query } from '../_generated/server';
import { v } from 'convex/values';

const operationValue = v.union(v.literal('create'), v.literal('update'), v.literal('delete'));

export const listReminderChangeEvents = query({
  args: { since: v.optional(v.number()) },
  handler: async (ctx, { since }) => {
    let query = ctx.db.query('noteChangeEvents');
    if (since !== undefined) {
      query = query.filter((q) => q.gt(q.field('changedAt'), since));
    }
    return query.collect();
  },
});

export const createReminderChangeEvent = mutation({
  args: {
    id: v.string(),
    noteId: v.string(),
    userId: v.string(),
    operation: operationValue,
    changedAt: v.number(),
    deviceId: v.string(),
    payloadHash: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('noteChangeEvents')
      .filter((q) =>
        q.and(
          q.eq(q.field('noteId'), args.noteId),
          q.eq(q.field('userId'), args.userId),
          q.eq(q.field('operation'), args.operation),
          q.eq(q.field('payloadHash'), args.payloadHash),
        ),
      )
      .first();

    if (existing) {
      return existing;
    }

    await ctx.db.insert('noteChangeEvents', args);
    return args;
  },
});
