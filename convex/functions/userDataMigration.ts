import { mutation } from '../_generated/server';
import { v } from 'convex/values';
import { sha256 } from 'js-sha256';

const THROTTLE_THRESHOLD = 3;
const BASE_BLOCK_MS = 60 * 1000;
const MAX_BLOCK_MS = 15 * 60 * 1000;

const verifyPassword = (password: string, storedHash: string): boolean => {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  return sha256(salt + password) === hash;
};

const computeBlockMs = (attempts: number): number | null => {
  if (attempts < THROTTLE_THRESHOLD) return null;
  const power = attempts - THROTTLE_THRESHOLD;
  return Math.min(MAX_BLOCK_MS, BASE_BLOCK_MS * 2 ** power);
};

export const migrateUserData = mutation({
  args: {
    fromUserId: v.string(),
    toUserId: v.string(),
    username: v.optional(v.string()),
    password: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { fromUserId, toUserId, username, password } = args;
    const now = Date.now();
    const attemptKey = toUserId;

    const existingAttempt = await ctx.db
      .query('migrationAttempts')
      .withIndex('by_key', (q) => q.eq('key', attemptKey))
      .first();

    if (existingAttempt?.blockedUntil && existingAttempt.blockedUntil > now) {
      throw new Error('Too many failed migration attempts. Try again later.');
    }

    const markFailedAttempt = async (): Promise<void> => {
      const attempts = (existingAttempt?.attempts ?? 0) + 1;
      const blockMs = computeBlockMs(attempts);
      const blockedUntil = blockMs ? now + blockMs : undefined;

      if (existingAttempt) {
        await ctx.db.patch(existingAttempt._id, {
          attempts,
          lastAttemptAt: now,
          blockedUntil,
        });
        return;
      }

      await ctx.db.insert('migrationAttempts', {
        key: attemptKey,
        attempts,
        lastAttemptAt: now,
        blockedUntil,
      });
    };

    const clearFailedAttempts = async (): Promise<void> => {
      if (!existingAttempt) return;
      await ctx.db.patch(existingAttempt._id, {
        attempts: 0,
        lastAttemptAt: now,
        blockedUntil: undefined,
      });
    };

    if (fromUserId === toUserId) {
      return { migrated: 0 };
    }

    // Strict policy: migrations are only allowed into existing account users.
    let targetUser: unknown = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      targetUser = await ctx.db.get(toUserId as any);
    } catch {
      targetUser = null;
    }
    if (!targetUser) {
      await markFailedAttempt();
      throw new Error('Migration target must be a valid account user');
    }

    if (!username || !password) {
      await markFailedAttempt();
      throw new Error('Credentials required to migrate data into this account');
    }

    const userByUsername = await ctx.db
      .query('users')
      .withIndex('by_username', (q) => q.eq('username', username))
      .first();

    if (!userByUsername || userByUsername._id.toString() !== toUserId) {
      await markFailedAttempt();
      throw new Error('Invalid migration target account');
    }

    if (!verifyPassword(password, userByUsername.passwordHash)) {
      await markFailedAttempt();
      throw new Error('Invalid credentials');
    }

    let migrated = 0;

    // Migrate notes
    const notes = await ctx.db
      .query('notes')
      .filter((q) => q.eq(q.field('userId'), fromUserId))
      .collect();

    for (const note of notes) {
      await ctx.db.patch(note._id, { userId: toUserId, updatedAt: Date.now() });
      migrated++;
    }

    // Migrate subscriptions
    const subscriptions = await ctx.db
      .query('subscriptions')
      .filter((q) => q.eq(q.field('userId'), fromUserId))
      .collect();

    for (const sub of subscriptions) {
      await ctx.db.patch(sub._id, { userId: toUserId, updatedAt: Date.now() });
      migrated++;
    }

    // Migrate device push tokens
    const tokens = await ctx.db
      .query('devicePushTokens')
      .filter((q) => q.eq(q.field('userId'), fromUserId))
      .collect();

    for (const token of tokens) {
      await ctx.db.patch(token._id, { userId: toUserId, updatedAt: Date.now() });
      migrated++;
    }

    // Migrate note change events
    const events = await ctx.db
      .query('noteChangeEvents')
      .filter((q) => q.eq(q.field('userId'), fromUserId))
      .collect();

    for (const event of events) {
      await ctx.db.patch(event._id, { userId: toUserId });
      migrated++;
    }

    await clearFailedAttempts();

    return { migrated };
  },
});
