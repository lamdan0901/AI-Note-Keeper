import { randomUUID } from 'node:crypto';

import { pool } from '../../db/pool.js';
import type { DbQueryClient, RefreshTokenRecord } from '../contracts.js';

export class RefreshTokenReplayError extends Error {
  constructor(message = 'Refresh token replay detected') {
    super(message);
    this.name = 'RefreshTokenReplayError';
  }
}

type RefreshTokenRow = Readonly<{
  id: string;
  user_id: string;
  token_hash: string;
  device_id: string | null;
  expires_at: Date;
  revoked: boolean;
}>;

const toRecord = (row: RefreshTokenRow): RefreshTokenRecord => {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    deviceId: row.device_id,
    expiresAt: new Date(row.expires_at),
    revoked: row.revoked,
  };
};

export type RefreshTokensRepository = Readonly<{
  insert: (
    input: Readonly<{
      userId: string;
      tokenHash: string;
      deviceId: string | null;
      expiresAt: Date;
    }>,
  ) => Promise<RefreshTokenRecord>;
  findByTokenHash: (tokenHash: string) => Promise<RefreshTokenRecord | null>;
  revokeById: (id: string) => Promise<void>;
  rotate: (
    input: Readonly<{
      currentTokenHash: string;
      nextTokenHash: string;
      userId: string;
      deviceId: string | null;
      expiresAt: Date;
    }>,
  ) => Promise<RefreshTokenRecord>;
}>;

export const createRefreshTokensRepository = (
  db: DbQueryClient = pool,
): RefreshTokensRepository => {
  const insert = async (input: {
    userId: string;
    tokenHash: string;
    deviceId: string | null;
    expiresAt: Date;
  }): Promise<RefreshTokenRecord> => {
    const id = randomUUID();
    const result = await db.query<RefreshTokenRow>(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, device_id, expires_at, revoked)
         VALUES ($1, $2, $3, $4, $5, false)
         RETURNING id, user_id, token_hash, device_id, expires_at, revoked`,
      [id, input.userId, input.tokenHash, input.deviceId, input.expiresAt],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to insert refresh token');
    }

    return toRecord(row);
  };

  return {
    insert,

    findByTokenHash: async (tokenHash) => {
      const result = await db.query<RefreshTokenRow>(
        `SELECT id, user_id, token_hash, device_id, expires_at, revoked
         FROM refresh_tokens
         WHERE token_hash = $1
         LIMIT 1`,
        [tokenHash],
      );

      const row = result.rows[0];
      return row ? toRecord(row) : null;
    },

    revokeById: async (id) => {
      await db.query('UPDATE refresh_tokens SET revoked = true WHERE id = $1', [id]);
    },

    rotate: async (input) => {
      const revokeResult = await db.query<RefreshTokenRow>(
        `UPDATE refresh_tokens
         SET revoked = true
         WHERE token_hash = $1 AND revoked = false AND expires_at > CURRENT_TIMESTAMP
         RETURNING id, user_id, token_hash, device_id, expires_at, revoked`,
        [input.currentTokenHash],
      );

      if (!revokeResult.rows[0]) {
        throw new RefreshTokenReplayError();
      }

      return await insert({
        userId: input.userId,
        tokenHash: input.nextTokenHash,
        deviceId: input.deviceId,
        expiresAt: input.expiresAt,
      });
    },
  };
};
