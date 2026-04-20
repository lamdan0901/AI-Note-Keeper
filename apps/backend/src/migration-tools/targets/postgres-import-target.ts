import type {
  ExportRecord,
  ImportBatchInput,
  ImportBatchResult,
  ImportTargetAdapter,
} from '../contracts.js';

type DbClient = Readonly<{
  query: (sql: string, params?: ReadonlyArray<unknown>) => Promise<unknown>;
}>;

let cachedDefaultDb: DbClient | null = null;

const loadDefaultDb = async (): Promise<DbClient> => {
  if (cachedDefaultDb) {
    return cachedDefaultDb;
  }

  const dbModule = await import('../../db/pool.js');
  cachedDefaultDb = dbModule.pool as DbClient;
  return cachedDefaultDb;
};

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
};

const toStringValue = (value: unknown, fallback = ''): string => {
  return typeof value === 'string' ? value : fallback;
};

const toNullableString = (value: unknown): string | null => {
  return typeof value === 'string' ? value : null;
};

const toBoolean = (value: unknown, fallback = false): boolean => {
  return typeof value === 'boolean' ? value : fallback;
};

const toNullableBoolean = (value: unknown): boolean | null => {
  return typeof value === 'boolean' ? value : null;
};

const toInteger = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
};

const toJsonValue = (value: unknown): unknown | null => {
  return value === undefined ? null : value;
};

const toDate = (value: unknown): Date | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value);
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed);
  }

  if (value instanceof Date) {
    return value;
  }

  return null;
};

const applyUser = async (db: DbClient, record: ExportRecord): Promise<void> => {
  await db.query(
    `INSERT INTO users (id, username, password_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE
     SET username = EXCLUDED.username,
         password_hash = EXCLUDED.password_hash,
         updated_at = CURRENT_TIMESTAMP`,
    [
      toStringValue(record.id),
      toStringValue(record.username),
      toStringValue(record.passwordHash || record.password_hash),
    ],
  );
};

const applyNote = async (db: DbClient, record: ExportRecord): Promise<void> => {
  await db.query(
    `INSERT INTO notes (
       id,
       user_id,
       title,
       content,
       content_type,
       color,
       active,
       done,
       is_pinned,
       trigger_at,
       repeat_rule,
       repeat_config,
       repeat,
       snoozed_until,
       schedule_status,
       timezone,
       base_at_local,
       start_at,
       next_trigger_at,
       last_fired_at,
       last_acknowledged_at,
       version,
       deleted_at,
       created_at,
       updated_at
     )
     VALUES (
       $1,
       $2,
       $3,
       $4,
       $5,
       $6,
       $7,
       $8,
       $9,
       $10,
       $11,
       $12,
       $13,
       $14,
       $15,
       $16,
       $17,
       $18,
       $19,
       $20,
       $21,
       COALESCE($22, 1),
       $23,
       COALESCE($24, CURRENT_TIMESTAMP),
       COALESCE($25, CURRENT_TIMESTAMP)
     )
     ON CONFLICT (id) DO UPDATE
     SET user_id = EXCLUDED.user_id,
       title = EXCLUDED.title,
         content = EXCLUDED.content,
         content_type = EXCLUDED.content_type,
         color = EXCLUDED.color,
         active = EXCLUDED.active,
         done = EXCLUDED.done,
         is_pinned = EXCLUDED.is_pinned,
         trigger_at = EXCLUDED.trigger_at,
         repeat_rule = EXCLUDED.repeat_rule,
         repeat_config = EXCLUDED.repeat_config,
         repeat = EXCLUDED.repeat,
         snoozed_until = EXCLUDED.snoozed_until,
         schedule_status = EXCLUDED.schedule_status,
         timezone = EXCLUDED.timezone,
         base_at_local = EXCLUDED.base_at_local,
         start_at = EXCLUDED.start_at,
         next_trigger_at = EXCLUDED.next_trigger_at,
         last_fired_at = EXCLUDED.last_fired_at,
         last_acknowledged_at = EXCLUDED.last_acknowledged_at,
         version = EXCLUDED.version,
         deleted_at = EXCLUDED.deleted_at,
         updated_at = EXCLUDED.updated_at`,
    [
      toStringValue(record.id),
      toStringValue(record.userId ?? record.user_id),
      toNullableString(record.title),
      toNullableString(record.content),
      toNullableString(record.contentType ?? record.content_type),
      toNullableString(record.color),
      toBoolean(record.active, true),
      toNullableBoolean(record.done),
      toNullableBoolean(record.isPinned ?? record.is_pinned),
      toDate(record.triggerAt ?? record.trigger_at),
      toNullableString(record.repeatRule ?? record.repeat_rule),
      toJsonValue(record.repeatConfig ?? record.repeat_config),
      toJsonValue(record.repeat),
      toDate(record.snoozedUntil ?? record.snoozed_until),
      toNullableString(record.scheduleStatus ?? record.schedule_status),
      toNullableString(record.timezone),
      toNullableString(record.baseAtLocal ?? record.base_at_local),
      toDate(record.startAt ?? record.start_at),
      toDate(record.nextTriggerAt ?? record.next_trigger_at),
      toDate(record.lastFiredAt ?? record.last_fired_at),
      toDate(record.lastAcknowledgedAt ?? record.last_acknowledged_at),
      toInteger(record.version),
      toDate(record.deletedAt ?? record.deleted_at),
      toDate(record.createdAt ?? record.created_at),
      toDate(record.updatedAt ?? record.updated_at),
    ],
  );
};

const applySubscription = async (db: DbClient, record: ExportRecord): Promise<void> => {
  await db.query(
    `INSERT INTO subscriptions (id, user_id, service_name, category, price, currency, billing_cycle, next_billing_date, status, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, CURRENT_TIMESTAMP), $9, $10)
     ON CONFLICT (id) DO UPDATE
     SET service_name = EXCLUDED.service_name,
         category = EXCLUDED.category,
         price = EXCLUDED.price,
         next_billing_date = EXCLUDED.next_billing_date,
         status = EXCLUDED.status,
         active = EXCLUDED.active,
         updated_at = CURRENT_TIMESTAMP`,
    [
      toStringValue(record.id),
      toStringValue(record.userId || record.user_id),
      toStringValue(record.serviceName || record.service_name),
      toStringValue(record.category, 'other'),
      toNumber(record.price),
      toStringValue(record.currency, 'USD'),
      toStringValue(record.billingCycle || record.billing_cycle, 'monthly'),
      toDate(record.nextBillingDate || record.next_billing_date),
      toStringValue(record.status, 'active'),
      toBoolean(record.active, true),
    ],
  );
};

const applyToken = async (db: DbClient, record: ExportRecord): Promise<void> => {
  await db.query(
    `INSERT INTO device_push_tokens (id, user_id, device_id, fcm_token, platform)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE
     SET user_id = EXCLUDED.user_id,
         device_id = EXCLUDED.device_id,
         fcm_token = EXCLUDED.fcm_token,
         platform = EXCLUDED.platform,
         updated_at = CURRENT_TIMESTAMP`,
    [
      toStringValue(record.id),
      toStringValue(record.userId || record.user_id),
      toStringValue(record.deviceId || record.device_id),
      toStringValue(record.fcmToken || record.fcm_token),
      toStringValue(record.platform, 'android'),
    ],
  );
};

const applyEvent = async (db: DbClient, record: ExportRecord): Promise<void> => {
  await db.query(
    `INSERT INTO note_change_events (id, note_id, user_id, operation, changed_at, device_id, payload_hash)
     VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_TIMESTAMP), $6, $7)
     ON CONFLICT (note_id, user_id, operation, payload_hash) DO NOTHING`,
    [
      toStringValue(record.id),
      toStringValue(record.noteId || record.note_id),
      toStringValue(record.userId || record.user_id),
      toStringValue(record.operation),
      toDate(record.changedAt || record.changed_at),
      toStringValue(record.deviceId || record.device_id),
      toStringValue(record.payloadHash || record.payload_hash),
    ],
  );
};

const applyCronState = async (db: DbClient, record: ExportRecord): Promise<void> => {
  await db.query(
    `INSERT INTO cron_state (key, last_checked_at)
     VALUES ($1, COALESCE($2, CURRENT_TIMESTAMP))
     ON CONFLICT (key) DO UPDATE
     SET last_checked_at = EXCLUDED.last_checked_at`,
    [toStringValue(record.key), toDate(record.lastCheckedAt || record.last_checked_at)],
  );
};

const applyMigrationAttempt = async (db: DbClient, record: ExportRecord): Promise<void> => {
  await db.query(
    `INSERT INTO migration_attempts (id, key, attempts, last_attempt_at, blocked_until)
     VALUES ($1, $2, $3, COALESCE($4, CURRENT_TIMESTAMP), $5)
     ON CONFLICT (key) DO UPDATE
     SET attempts = EXCLUDED.attempts,
         last_attempt_at = EXCLUDED.last_attempt_at,
         blocked_until = EXCLUDED.blocked_until`,
    [
      toStringValue(record.id),
      toStringValue(record.key),
      toNumber(record.attempts),
      toDate(record.lastAttemptAt || record.last_attempt_at),
      toDate(record.blockedUntil || record.blocked_until),
    ],
  );
};

const applyRefreshToken = async (db: DbClient, record: ExportRecord): Promise<void> => {
  await db.query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, device_id, expires_at, revoked)
     VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_TIMESTAMP), $6)
     ON CONFLICT (token_hash) DO UPDATE
     SET revoked = EXCLUDED.revoked,
         expires_at = EXCLUDED.expires_at,
         device_id = EXCLUDED.device_id`,
    [
      toStringValue(record.id),
      toStringValue(record.userId || record.user_id),
      toStringValue(record.tokenHash || record.token_hash),
      toStringValue(record.deviceId || record.device_id),
      toDate(record.expiresAt || record.expires_at),
      toBoolean(record.revoked, false),
    ],
  );
};

const applyRecord = async (db: DbClient, input: ImportBatchInput): Promise<void> => {
  for (const record of input.records) {
    switch (input.entity) {
      case 'users':
        await applyUser(db, record);
        break;
      case 'notes':
        await applyNote(db, record);
        break;
      case 'subscriptions':
        await applySubscription(db, record);
        break;
      case 'devicePushTokens':
        await applyToken(db, record);
        break;
      case 'noteChangeEvents':
        await applyEvent(db, record);
        break;
      case 'cronState':
        await applyCronState(db, record);
        break;
      case 'migrationAttempts':
        await applyMigrationAttempt(db, record);
        break;
      case 'refreshTokens':
        await applyRefreshToken(db, record);
        break;
      default:
        break;
    }
  }
};

const lastProcessedId = (input: ImportBatchInput): string | undefined => {
  const lastRecord = input.records[input.records.length - 1];
  if (!lastRecord) {
    return undefined;
  }

  const id = lastRecord.id;
  return typeof id === 'string' ? id : undefined;
};

export const createPostgresImportTarget = (db?: DbClient): ImportTargetAdapter => {
  return {
    applyBatch: async (input): Promise<ImportBatchResult> => {
      if (input.records.length === 0) {
        return {
          processedRecords: 0,
        };
      }

      if (!input.dryRun) {
        const targetDb = db ?? (await loadDefaultDb());
        await applyRecord(targetDb, input);
      }

      return {
        processedRecords: input.records.length,
        lastProcessedId: lastProcessedId(input),
      };
    },
  };
};
