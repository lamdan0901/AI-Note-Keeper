import { mutation } from '../_generated/server';
import { v } from 'convex/values';

/**
 * Backfill `deletedAt` for existing soft-deleted subscriptions that lack the field.
 * Sets `deletedAt` to `updatedAt` so they enter the 14-day purge pipeline.
 */
export const backfillDeletedAt = mutation({
  args: {
    batchSize: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 200;
    const cursor = args.cursor ?? null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pageResult = await (ctx.db.query('subscriptions') as any).paginate({
      cursor,
      numItems: batchSize,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = (pageResult.page as any[]) ?? [];

    let processed = 0;
    let patched = 0;
    let skipped = 0;

    for (const subscription of page) {
      processed++;
      if (subscription.active !== false) {
        skipped++;
        continue;
      }
      if (subscription.deletedAt !== undefined && subscription.deletedAt !== null) {
        skipped++;
        continue;
      }

      await ctx.db.patch(subscription._id, { deletedAt: subscription.updatedAt });
      patched++;
    }

    return {
      processed,
      patched,
      skipped,
      nextCursor: pageResult.continueCursor as string | null,
      hasMore: !pageResult.isDone,
    };
  },
});
