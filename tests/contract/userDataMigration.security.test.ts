import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { sha256 } from 'js-sha256';

type HandlerConfig = {
  handler: (...args: unknown[]) => unknown;
  [key: string]: unknown;
};

type Handler = (ctx: typeof mockCtx, args: Record<string, unknown>) => Promise<unknown>;

const makeQueryChain = () => {
  const chain: any = {
    withIndex: jest.fn(),
    filter: jest.fn(),
    first: jest.fn(),
    collect: jest.fn(),
  };
  chain.withIndex.mockReturnValue(chain);
  chain.filter.mockReturnValue(chain);
  return chain;
};

const migrationAttemptsQuery = makeQueryChain();
const usersQuery = makeQueryChain();
const notesQuery = makeQueryChain();
const subscriptionsQuery = makeQueryChain();
const tokensQuery = makeQueryChain();
const eventsQuery = makeQueryChain();

const mockDb = {
  query: jest.fn((table: string) => {
    if (table === 'migrationAttempts') return migrationAttemptsQuery;
    if (table === 'users') return usersQuery;
    if (table === 'notes') return notesQuery;
    if (table === 'subscriptions') return subscriptionsQuery;
    if (table === 'devicePushTokens') return tokensQuery;
    if (table === 'noteChangeEvents') return eventsQuery;
    throw new Error(`Unexpected query table: ${table}`);
  }),
  patch: jest.fn(),
  insert: jest.fn(),
  get: jest.fn(),
};

const mockCtx = { db: mockDb };

const mockMutation = jest.fn((config: HandlerConfig) => ({
  ...config,
  _handler: config.handler,
}));

jest.mock(
  '../../convex/_generated/server',
  () => ({
    mutation: mockMutation,
  }),
  { virtual: true },
);

jest.mock(
  'convex/values',
  () => {
    const v: Record<string, jest.Mock> = {};
    const pass = () => ({});
    ['string', 'number', 'boolean', 'any', 'null'].forEach((k) => (v[k] = jest.fn(pass)));
    v['optional'] = jest.fn(pass);
    v['union'] = jest.fn(pass);
    v['array'] = jest.fn(pass);
    v['object'] = jest.fn(pass);
    return { v };
  },
  { virtual: true },
);

import { migrateUserData } from '../../convex/functions/userDataMigration';

describe('userDataMigration security and throttling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (migrationAttemptsQuery.first as any).mockResolvedValue(null);
    (usersQuery.first as any).mockResolvedValue(null);
    (notesQuery.collect as any).mockResolvedValue([]);
    (subscriptionsQuery.collect as any).mockResolvedValue([]);
    (tokensQuery.collect as any).mockResolvedValue([]);
    (eventsQuery.collect as any).mockResolvedValue([]);
    (mockDb.get as any).mockResolvedValue(null);
  });

  test('rejects non-account target userId and records failed attempt', async () => {
    const handler = (migrateUserData as unknown as { _handler: Handler })._handler;

    await expect(
      handler(mockCtx, {
        fromUserId: 'device-1',
        toUserId: 'not-an-account',
        username: 'alice',
        password: 'password123',
      }),
    ).rejects.toThrow('Migration target must be a valid account user');

    expect(mockDb.insert).toHaveBeenCalledWith(
      'migrationAttempts',
      expect.objectContaining({
        key: 'not-an-account',
        attempts: 1,
      }),
    );
  });

  test('uses target-account keyed throttling even when source id changes', async () => {
    const handler = (migrateUserData as unknown as { _handler: Handler })._handler;

    (mockDb.get as any).mockResolvedValue({ _id: 'user-target' });
    (usersQuery.first as any).mockResolvedValue({
      _id: { toString: () => 'user-target' },
      username: 'alice',
      passwordHash: 'bad:hash',
    });

    await expect(
      handler(mockCtx, {
        fromUserId: 'device-a',
        toUserId: 'user-target',
        username: 'alice',
        password: 'wrong',
      }),
    ).rejects.toThrow('Invalid credentials');

    expect(mockDb.insert).toHaveBeenCalledWith(
      'migrationAttempts',
      expect.objectContaining({ key: 'user-target', attempts: 1 }),
    );
  });

  test('blocks immediately when migration key is currently throttled', async () => {
    const handler = (migrateUserData as unknown as { _handler: Handler })._handler;
    (migrationAttemptsQuery.first as any).mockResolvedValue({
      _id: 'attempt-1',
      key: 'device-1->user-1',
      attempts: 4,
      blockedUntil: Date.now() + 60_000,
      lastAttemptAt: Date.now(),
    });

    await expect(
      handler(mockCtx, {
        fromUserId: 'device-1',
        toUserId: 'user-1',
        username: 'alice',
        password: 'password123',
      }),
    ).rejects.toThrow('Too many failed migration attempts. Try again later.');

    expect(mockDb.get).not.toHaveBeenCalled();
  });

  test('increments failed attempts when credentials are invalid', async () => {
    const handler = (migrateUserData as unknown as { _handler: Handler })._handler;

    (migrationAttemptsQuery.first as any).mockResolvedValue({
      _id: 'attempt-2',
      key: 'device-2->user-2',
      attempts: 2,
      blockedUntil: undefined,
      lastAttemptAt: Date.now(),
    });

    (mockDb.get as any).mockResolvedValue({ _id: 'user-2' });
    (usersQuery.first as any).mockResolvedValue({
      _id: { toString: () => 'user-2' },
      username: 'alice',
      passwordHash: 'bad:hash',
    });

    await expect(
      handler(mockCtx, {
        fromUserId: 'device-2',
        toUserId: 'user-2',
        username: 'alice',
        password: 'wrong',
      }),
    ).rejects.toThrow('Invalid credentials');

    expect(mockDb.patch).toHaveBeenCalledWith(
      'attempt-2',
      expect.objectContaining({ attempts: 3 }),
    );
  });

  test('resets failed attempts after successful migration', async () => {
    const handler = (migrateUserData as unknown as { _handler: Handler })._handler;

    const salt = 'abcd';
    const password = 'pass1234';

    (migrationAttemptsQuery.first as any).mockResolvedValue({
      _id: 'attempt-3',
      key: 'device-3->user-3',
      attempts: 2,
      blockedUntil: undefined,
      lastAttemptAt: Date.now(),
    });

    (mockDb.get as any).mockResolvedValue({ _id: 'user-3' });
    (usersQuery.first as any).mockResolvedValue({
      _id: { toString: () => 'user-3' },
      username: 'alice',
      passwordHash: `${salt}:${sha256(salt + password)}`,
    });

    (notesQuery.collect as any).mockResolvedValue([{ _id: 'n1' }]);
    (subscriptionsQuery.collect as any).mockResolvedValue([{ _id: 's1' }]);
    (tokensQuery.collect as any).mockResolvedValue([{ _id: 't1' }]);
    (eventsQuery.collect as any).mockResolvedValue([{ _id: 'e1' }]);

    const result = (await handler(mockCtx, {
      fromUserId: 'device-3',
      toUserId: 'user-3',
      username: 'alice',
      password,
    })) as { migrated: number };

    expect(result).toEqual({ migrated: 4 });
    expect(mockDb.patch).toHaveBeenCalledWith('n1', expect.objectContaining({ userId: 'user-3' }));
    expect(mockDb.patch).toHaveBeenCalledWith('s1', expect.objectContaining({ userId: 'user-3' }));
    expect(mockDb.patch).toHaveBeenCalledWith('t1', expect.objectContaining({ userId: 'user-3' }));
    expect(mockDb.patch).toHaveBeenCalledWith('e1', expect.objectContaining({ userId: 'user-3' }));
    expect(mockDb.patch).toHaveBeenCalledWith(
      'attempt-3',
      expect.objectContaining({ attempts: 0, blockedUntil: undefined }),
    );
  });
});
