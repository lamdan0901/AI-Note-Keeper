import assert from 'node:assert/strict';
import test from 'node:test';

import type { DbQueryClient } from '../../auth/contracts.js';
import { createRefreshTokensRepository } from '../../auth/repositories/refresh-tokens-repository.js';

type StoredRefreshRow = {
  id: string;
  user_id: string;
  token_hash: string;
  device_id: string | null;
  expires_at: Date;
  revoked: boolean;
};

const createInMemoryDb = (): DbQueryClient => {
  const rows: Array<StoredRefreshRow> = [];

  return {
    query: async <Row extends Record<string, unknown>>(
      text: string,
      values: ReadonlyArray<unknown> = [],
    ) => {
      const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();

      if (normalized.startsWith('insert into refresh_tokens')) {
        const [id, userId, tokenHash, deviceId, expiresAt] = values as [
          string,
          string,
          string,
          string | null,
          Date,
        ];

        const nextRow: StoredRefreshRow = {
          id,
          user_id: userId,
          token_hash: tokenHash,
          device_id: deviceId,
          expires_at: expiresAt,
          revoked: false,
        };

        rows.push(nextRow);
        return { rows: [nextRow] as unknown as ReadonlyArray<Row> };
      }

      if (normalized.includes('from refresh_tokens') && normalized.includes('where token_hash')) {
        const [tokenHash] = values as [string];
        const found = rows.find((row) => row.token_hash === tokenHash);
        return { rows: (found ? [found] : []) as unknown as ReadonlyArray<Row> };
      }

      if (normalized.startsWith('update refresh_tokens set revoked = true where id =')) {
        const [id] = values as [string];
        const index = rows.findIndex((row) => row.id === id);
        if (index >= 0) {
          rows[index] = {
            ...rows[index],
            revoked: true,
          };
        }
        return { rows: [] as ReadonlyArray<Row> };
      }

      throw new Error(`Unsupported query in test adapter: ${text}`);
    },
  };
};

test('multiple active refresh token rows can coexist for one user', async () => {
  const repo = createRefreshTokensRepository(createInMemoryDb());

  const token1 = await repo.insert({
    userId: 'u1',
    tokenHash: 'token-hash-1',
    deviceId: 'device-a',
    expiresAt: new Date(Date.now() + 60_000),
  });

  const token2 = await repo.insert({
    userId: 'u1',
    tokenHash: 'token-hash-2',
    deviceId: 'device-b',
    expiresAt: new Date(Date.now() + 60_000),
  });

  assert.equal(token1.userId, 'u1');
  assert.equal(token2.userId, 'u1');
  assert.equal(token1.id === token2.id, false);

  const found1 = await repo.findByTokenHash('token-hash-1');
  const found2 = await repo.findByTokenHash('token-hash-2');

  assert.equal(found1?.revoked, false);
  assert.equal(found2?.revoked, false);
});

test('refresh reuse detection marks current token lineage revoked and blocks replay', async () => {
  const repo = createRefreshTokensRepository(createInMemoryDb());

  await repo.insert({
    userId: 'u1',
    tokenHash: 'current-token',
    deviceId: 'device-a',
    expiresAt: new Date(Date.now() + 60_000),
  });

  await repo.rotate({
    currentTokenHash: 'current-token',
    nextTokenHash: 'next-token',
    userId: 'u1',
    deviceId: 'device-a',
    expiresAt: new Date(Date.now() + 120_000),
  });

  const revokedCurrent = await repo.findByTokenHash('current-token');
  assert.equal(revokedCurrent?.revoked, true);

  await assert.rejects(() =>
    repo.rotate({
      currentTokenHash: 'current-token',
      nextTokenHash: 'second-next-token',
      userId: 'u1',
      deviceId: 'device-a',
      expiresAt: new Date(Date.now() + 120_000),
    }),
  );
});

test('logout/current-session revoke leaves other session tokens valid', async () => {
  const repo = createRefreshTokensRepository(createInMemoryDb());

  const token1 = await repo.insert({
    userId: 'u1',
    tokenHash: 'session-1-token',
    deviceId: 'device-a',
    expiresAt: new Date(Date.now() + 60_000),
  });

  await repo.insert({
    userId: 'u1',
    tokenHash: 'session-2-token',
    deviceId: 'device-b',
    expiresAt: new Date(Date.now() + 60_000),
  });

  await repo.revokeById(token1.id);

  const session1 = await repo.findByTokenHash('session-1-token');
  const session2 = await repo.findByTokenHash('session-2-token');

  assert.equal(session1?.revoked, true);
  assert.equal(session2?.revoked, false);
});
