import { mutation, query } from '../_generated/server';
import { v } from 'convex/values';
import { sha256 } from 'js-sha256';

const generateSalt = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const hashPassword = (password: string, salt: string): string => {
  return sha256(salt + password);
};

const verifyPassword = (password: string, storedHash: string): boolean => {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  return hashPassword(password, salt) === hash;
};

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;
const MIN_PASSWORD_LENGTH = 8;

export const register = mutation({
  args: {
    username: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const { username, password } = args;

    if (!USERNAME_REGEX.test(username)) {
      throw new Error(
        'Username must be 3-30 characters, alphanumeric and underscores only',
      );
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }

    const existing = await ctx.db
      .query('users')
      .withIndex('by_username', (q) => q.eq('username', username))
      .first();

    if (existing) {
      throw new Error('Username already taken');
    }

    const salt = generateSalt();
    const hash = hashPassword(password, salt);
    const passwordHash = `${salt}:${hash}`;

    const now = Date.now();
    const userId = await ctx.db.insert('users', {
      username,
      passwordHash,
      createdAt: now,
      updatedAt: now,
    });

    return { userId: userId.toString(), username };
  },
});

export const login = mutation({
  args: {
    username: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const { username, password } = args;

    const user = await ctx.db
      .query('users')
      .withIndex('by_username', (q) => q.eq('username', username))
      .first();

    if (!user) {
      throw new Error('Invalid username or password');
    }

    if (!verifyPassword(password, user.passwordHash)) {
      throw new Error('Invalid username or password');
    }

    await ctx.db.patch(user._id, { updatedAt: Date.now() });

    return { userId: user._id.toString(), username: user.username };
  },
});

export const validateSession = query({
  args: {
    userId: v.id('users'),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);

    if (!user) {
      return null;
    }

    return { userId: user._id.toString(), username: user.username };
  },
});
