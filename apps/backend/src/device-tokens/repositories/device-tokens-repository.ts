import { randomUUID } from 'node:crypto';

import type { DbQueryClient } from '../../auth/contracts.js';
import { pool } from '../../db/pool.js';
import type { DeviceTokenRecord } from '../contracts.js';

type DeviceTokenRow = Readonly<{
  id: string;
  user_id: string;
  device_id: string;
  fcm_token: string;
  platform: 'android';
  updated_at: Date;
  created_at: Date;
}>;

export type DeviceTokensRepository = Readonly<{
  listByUserId: (userId: string) => Promise<ReadonlyArray<DeviceTokenRecord>>;
  findByDeviceId: (deviceId: string) => Promise<DeviceTokenRecord | null>;
  insert: (
    input: Readonly<{ userId: string; deviceId: string; fcmToken: string; platform: 'android' }>,
  ) => Promise<DeviceTokenRecord>;
  updateByDeviceId: (
    input: Readonly<{ userId: string; deviceId: string; fcmToken: string; platform: 'android' }>,
  ) => Promise<DeviceTokenRecord | null>;
  deleteByDeviceIdForUser: (
    input: Readonly<{ userId: string; deviceId: string }>,
  ) => Promise<boolean>;
}>;

const toDomain = (row: DeviceTokenRow): DeviceTokenRecord => {
  return {
    id: row.id,
    userId: row.user_id,
    deviceId: row.device_id,
    fcmToken: row.fcm_token,
    platform: row.platform,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
};

export const createDeviceTokensRepository = (
  deps: Readonly<{ db?: DbQueryClient }> = {},
): DeviceTokensRepository => {
  const db = deps.db ?? pool;

  return {
    listByUserId: async (userId) => {
      const result = await db.query<DeviceTokenRow>(
        `
          SELECT *
          FROM device_push_tokens
          WHERE user_id = $1
          ORDER BY updated_at DESC
        `,
        [userId],
      );

      return result.rows.map((row) => toDomain(row));
    },

    findByDeviceId: async (deviceId) => {
      const result = await db.query<DeviceTokenRow>(
        `
          SELECT *
          FROM device_push_tokens
          WHERE device_id = $1
          LIMIT 1
        `,
        [deviceId],
      );

      if (result.rows.length === 0) {
        return null;
      }

      return toDomain(result.rows[0]);
    },

    insert: async ({ userId, deviceId, fcmToken, platform }) => {
      const result = await db.query<DeviceTokenRow>(
        `
          INSERT INTO device_push_tokens (
            id,
            user_id,
            device_id,
            fcm_token,
            platform,
            updated_at,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
          RETURNING *
        `,
        [randomUUID(), userId, deviceId, fcmToken, platform],
      );

      return toDomain(result.rows[0]);
    },

    updateByDeviceId: async ({ userId, deviceId, fcmToken, platform }) => {
      const result = await db.query<DeviceTokenRow>(
        `
          UPDATE device_push_tokens
          SET fcm_token = $1,
              platform = $2,
              updated_at = NOW()
          WHERE device_id = $3
            AND user_id = $4
          RETURNING *
        `,
        [fcmToken, platform, deviceId, userId],
      );

      if (result.rows.length === 0) {
        return null;
      }

      return toDomain(result.rows[0]);
    },

    deleteByDeviceIdForUser: async ({ userId, deviceId }) => {
      const result = await db.query<{ id: string }>(
        `
          DELETE FROM device_push_tokens
          WHERE device_id = $1
            AND user_id = $2
          RETURNING id
        `,
        [deviceId, userId],
      );

      return result.rows.length > 0;
    },
  };
};
