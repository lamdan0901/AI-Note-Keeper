import { randomUUID } from 'node:crypto';

import { pool } from '../../db/pool.js';
import type { DbQueryClient, UserRecord } from '../contracts.js';

type UserRow = Readonly<{
  id: string;
  username: string;
  password_hash: string;
}>;

const toUserRecord = (row: UserRow): UserRecord => {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
  };
};

export type UsersRepository = Readonly<{
  findByUsername: (username: string) => Promise<UserRecord | null>;
  findById: (id: string) => Promise<UserRecord | null>;
  createUser: (input: Readonly<{ username: string; passwordHash: string }>) => Promise<UserRecord>;
  updatePasswordHash: (input: Readonly<{ userId: string; passwordHash: string }>) => Promise<void>;
}>;

export const createUsersRepository = (db: DbQueryClient = pool): UsersRepository => {
  return {
    findByUsername: async (username) => {
      const result = await db.query<UserRow>(
        'SELECT id, username, password_hash FROM users WHERE username = $1 LIMIT 1',
        [username],
      );

      const row = result.rows[0];
      return row ? toUserRecord(row) : null;
    },

    findById: async (id) => {
      const result = await db.query<UserRow>(
        'SELECT id, username, password_hash FROM users WHERE id = $1 LIMIT 1',
        [id],
      );

      const row = result.rows[0];
      return row ? toUserRecord(row) : null;
    },

    createUser: async (input) => {
      const id = randomUUID();
      const result = await db.query<UserRow>(
        `INSERT INTO users (id, username, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, username, password_hash`,
        [id, input.username, input.passwordHash],
      );

      const row = result.rows[0];
      if (!row) {
        throw new Error('Failed to create user');
      }

      return toUserRecord(row);
    },

    updatePasswordHash: async (input) => {
      await db.query('UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [
        input.passwordHash,
        input.userId,
      ]);
    },
  };
};
