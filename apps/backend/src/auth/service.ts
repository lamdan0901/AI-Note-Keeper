import { randomUUID } from 'node:crypto';

import { AppError } from '../middleware/error-middleware.js';
import { readAuthConfig } from '../config.js';
import { errors as joseErrors, jwtVerify } from 'jose';
import { pool } from '../db/pool.js';
import type { TokenPair } from './contracts.js';
import { hashPasswordArgon2id, verifyPassword } from './passwords.js';
import {
  createRefreshTokensRepository,
  RefreshTokenReplayError,
  type RefreshTokensRepository,
} from './repositories/refresh-tokens-repository.js';
import { createUsersRepository, type UsersRepository } from './repositories/users-repository.js';
import { createTokenFactory } from './tokens.js';

type AuthSession = Readonly<{
  userId: string;
  username: string;
  tokens: TokenPair;
}>;

type AuthServiceDeps = Readonly<{
  usersRepository?: UsersRepository;
  refreshTokensRepository?: RefreshTokensRepository;
  tokenFactory?: ReturnType<typeof createTokenFactory>;
  guestDataCopier?: GuestDataCopier;
}>;

type GuestDataCopier = (
  input: Readonly<{ guestUserId: string; accountUserId: string }>,
) => Promise<void>;

export type AuthService = Readonly<{
  register: (
    input: Readonly<{
      username: string;
      password: string;
      deviceId: string | null;
      guestUserId?: string;
    }>,
  ) => Promise<AuthSession>;
  login: (
    input: Readonly<{ username: string; password: string; deviceId: string | null }>,
  ) => Promise<AuthSession>;
  upgradeSession: (
    input: Readonly<{ userId: string; deviceId: string | null; legacySessionToken?: string }>,
  ) => Promise<AuthSession>;
  refresh: (
    input: Readonly<{ refreshToken: string; deviceId: string | null }>,
  ) => Promise<AuthSession>;
  logout: (input: Readonly<{ refreshToken: string }>) => Promise<void>;
}>;

const WEB_GUEST_USER_ID_PREFIX = 'web-guest-';
const WEB_GUEST_USERNAME_PREFIX = '__web_guest_user__';
const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const toGuestUsername = (guestUserId: string): string => {
  return `${WEB_GUEST_USERNAME_PREFIX}${guestUserId}`;
};

const isWebGuestUserId = (value: string): boolean => {
  if (value.startsWith(WEB_GUEST_USER_ID_PREFIX)) {
    const suffix = value.slice(WEB_GUEST_USER_ID_PREFIX.length);
    return UUID_V4_LIKE_PATTERN.test(suffix);
  }

  // Backward compatibility for older installs that used raw UUID local IDs.
  return UUID_V4_LIKE_PATTERN.test(value);
};

type GuestUserRow = Readonly<{
  id: string;
  username: string;
}>;

type GuestNoteRow = Readonly<{
  title: string | null;
  content: string | null;
  content_type: string | null;
  color: string | null;
  active: boolean;
  done: boolean | null;
  is_pinned: boolean | null;
  trigger_at: Date | null;
  repeat_rule: string | null;
  repeat_config: Record<string, unknown> | null;
  repeat: Record<string, unknown> | null;
  snoozed_until: Date | null;
  schedule_status: string | null;
  timezone: string | null;
  base_at_local: string | null;
  start_at: Date | null;
  next_trigger_at: Date | null;
  last_fired_at: Date | null;
  last_acknowledged_at: Date | null;
  version: number | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}>;

type GuestSubscriptionRow = Readonly<{
  service_name: string;
  category: string;
  price: number;
  currency: string;
  billing_cycle: string;
  billing_cycle_custom_days: number | null;
  next_billing_date: Date;
  notes: string | null;
  trial_end_date: Date | null;
  status: string;
  reminder_days_before: unknown;
  next_reminder_at: Date | null;
  last_notified_billing_date: Date | null;
  next_trial_reminder_at: Date | null;
  last_notified_trial_end_date: Date | null;
  active: boolean;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}>;

const toAuthError = (message = 'Unauthorized'): AppError => {
  return new AppError({ code: 'auth', message });
};

const toConflictError = (message: string): AppError => {
  return new AppError({ code: 'conflict', message });
};

const issueSession = async (
  input: Readonly<{
    userId: string;
    username: string;
    deviceId: string | null;
    tokenFactory: ReturnType<typeof createTokenFactory>;
    refreshTokensRepository: RefreshTokensRepository;
  }>,
): Promise<AuthSession> => {
  const tokens = await input.tokenFactory.issueTokenPair({
    userId: input.userId,
    username: input.username,
  });

  const refreshHash = input.tokenFactory.hashRefreshToken(tokens.refreshToken);

  await input.refreshTokensRepository.insert({
    userId: input.userId,
    tokenHash: refreshHash,
    deviceId: input.deviceId,
    expiresAt: new Date(tokens.refreshExpiresAt),
  });

  return {
    userId: input.userId,
    username: input.username,
    tokens,
  };
};

const defaultGuestDataCopier: GuestDataCopier = async ({ guestUserId, accountUserId }) => {
  if (!guestUserId || guestUserId === accountUserId) {
    return;
  }

  if (!isWebGuestUserId(guestUserId)) {
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const guestUser = await client.query<GuestUserRow>(
      `
        SELECT id, username
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [guestUserId],
    );

    const guestUserRow = guestUser.rows[0];
    if (!guestUserRow || guestUserRow.username !== toGuestUsername(guestUserId)) {
      await client.query('COMMIT');
      return;
    }

    const notes = await client.query<GuestNoteRow>(
      `
        SELECT
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
        FROM notes
        WHERE user_id = $1
        ORDER BY updated_at ASC
      `,
      [guestUserId],
    );

    for (const note of notes.rows) {
      await client.query(
        `
          INSERT INTO notes (
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
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
            $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
            $21,$22,$23,$24,$25
          )
        `,
        [
          randomUUID(),
          accountUserId,
          note.title,
          note.content,
          note.content_type,
          note.color,
          note.active,
          note.done,
          note.is_pinned,
          note.trigger_at,
          note.repeat_rule,
          note.repeat_config,
          note.repeat,
          note.snoozed_until,
          note.schedule_status,
          note.timezone,
          note.base_at_local,
          note.start_at,
          note.next_trigger_at,
          note.last_fired_at,
          note.last_acknowledged_at,
          note.version ?? 1,
          note.deleted_at,
          note.created_at,
          note.updated_at,
        ],
      );
    }

    const subscriptions = await client.query<GuestSubscriptionRow>(
      `
        SELECT
          service_name,
          category,
          price,
          currency,
          billing_cycle,
          billing_cycle_custom_days,
          next_billing_date,
          notes,
          trial_end_date,
          status,
          reminder_days_before,
          next_reminder_at,
          last_notified_billing_date,
          next_trial_reminder_at,
          last_notified_trial_end_date,
          active,
          deleted_at,
          created_at,
          updated_at
        FROM subscriptions
        WHERE user_id = $1
        ORDER BY updated_at ASC
      `,
      [guestUserId],
    );

    for (const subscription of subscriptions.rows) {
      await client.query(
        `
          INSERT INTO subscriptions (
            id,
            user_id,
            service_name,
            category,
            price,
            currency,
            billing_cycle,
            billing_cycle_custom_days,
            next_billing_date,
            notes,
            trial_end_date,
            status,
            reminder_days_before,
            next_reminder_at,
            last_notified_billing_date,
            next_trial_reminder_at,
            last_notified_trial_end_date,
            active,
            deleted_at,
            created_at,
            updated_at
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
            $11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19,$20,$21
          )
        `,
        [
          randomUUID(),
          accountUserId,
          subscription.service_name,
          subscription.category,
          subscription.price,
          subscription.currency,
          subscription.billing_cycle,
          subscription.billing_cycle_custom_days,
          subscription.next_billing_date,
          subscription.notes,
          subscription.trial_end_date,
          subscription.status,
          JSON.stringify(subscription.reminder_days_before ?? []),
          subscription.next_reminder_at,
          subscription.last_notified_billing_date,
          subscription.next_trial_reminder_at,
          subscription.last_notified_trial_end_date,
          subscription.active,
          subscription.deleted_at,
          subscription.created_at,
          subscription.updated_at,
        ],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const verifyLegacyUpgradeToken = async (
  input: Readonly<{ userId: string; deviceId: string | null; legacySessionToken?: string }>,
): Promise<void> => {
  if (!input.legacySessionToken) {
    const allowTokenlessLegacyUpgrade =
      process.env.ALLOW_LEGACY_USERID_UPGRADE_WITHOUT_TOKEN === 'true';
    const allowTokenlessLegacyUpgradeInProduction =
      process.env.ALLOW_LEGACY_USERID_UPGRADE_WITHOUT_TOKEN_IN_PRODUCTION === 'true';
    const isProduction = process.env.NODE_ENV === 'production';

    const tokenlessUpgradeUntilRaw = process.env.LEGACY_USERID_UPGRADE_TOKENLESS_UNTIL;
    const tokenlessUpgradeUntil = tokenlessUpgradeUntilRaw
      ? new Date(tokenlessUpgradeUntilRaw)
      : null;

    const tokenlessUpgradeWindowActive =
      tokenlessUpgradeUntil !== null &&
      !Number.isNaN(tokenlessUpgradeUntil.getTime()) &&
      tokenlessUpgradeUntil.getTime() > Date.now();

    const tokenlessAllowedByEnvironment = !isProduction || allowTokenlessLegacyUpgradeInProduction;

    if (!allowTokenlessLegacyUpgrade || !tokenlessUpgradeWindowActive) {
      throw toAuthError('Legacy session token is required for upgrade-session');
    }

    if (!tokenlessAllowedByEnvironment) {
      throw toAuthError('Legacy session token is required for upgrade-session');
    }

    return;
  }

  const authConfig = readAuthConfig();
  const encoder = new TextEncoder();

  try {
    const verification = await jwtVerify(
      input.legacySessionToken,
      encoder.encode(authConfig.LEGACY_UPGRADE_SECRET),
      {
        issuer: authConfig.JWT_ISSUER,
        audience: authConfig.JWT_AUDIENCE,
      },
    );

    if (verification.payload.type !== 'legacy-upgrade') {
      throw toAuthError('Invalid legacy session token type');
    }

    if (typeof verification.payload.exp !== 'number') {
      throw toAuthError('Legacy session token must include expiration');
    }

    if (verification.payload.userId !== input.userId) {
      throw toAuthError('Legacy session token user mismatch');
    }

    if (typeof verification.payload.deviceId === 'string') {
      if (!input.deviceId || verification.payload.deviceId !== input.deviceId) {
        throw toAuthError('Legacy session token device mismatch');
      }
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    if (error instanceof joseErrors.JOSEError) {
      throw toAuthError('Invalid legacy session token');
    }

    throw toAuthError('Invalid legacy session token');
  }
};

export const createAuthService = (deps: AuthServiceDeps = {}): AuthService => {
  const authConfig = readAuthConfig();
  const usersRepository = deps.usersRepository ?? createUsersRepository();
  const refreshTokensRepository = deps.refreshTokensRepository ?? createRefreshTokensRepository();
  const tokenFactory = deps.tokenFactory ?? createTokenFactory(authConfig);
  const guestDataCopier = deps.guestDataCopier ?? defaultGuestDataCopier;

  return {
    register: async ({ username, password, deviceId, guestUserId }) => {
      const existing = await usersRepository.findByUsername(username);
      if (existing) {
        throw toConflictError('Username already taken');
      }

      const passwordHash = await hashPasswordArgon2id(password);
      const user = await usersRepository.createUser({ username, passwordHash });

      if (typeof guestUserId === 'string' && guestUserId.length > 0) {
        await guestDataCopier({
          guestUserId,
          accountUserId: user.id,
        });
      }

      return await issueSession({
        userId: user.id,
        username: user.username,
        deviceId,
        tokenFactory,
        refreshTokensRepository,
      });
    },

    login: async ({ username, password, deviceId }) => {
      const user = await usersRepository.findByUsername(username);
      if (!user) {
        throw toAuthError('Invalid username or password');
      }

      const verified = await verifyPassword(password, user.passwordHash);
      if (!verified.verified) {
        throw toAuthError('Invalid username or password');
      }

      if (verified.needsUpgrade) {
        const upgradedHash = await hashPasswordArgon2id(password);
        await usersRepository.updatePasswordHash({ userId: user.id, passwordHash: upgradedHash });
      }

      return await issueSession({
        userId: user.id,
        username: user.username,
        deviceId,
        tokenFactory,
        refreshTokensRepository,
      });
    },

    upgradeSession: async ({ userId, deviceId, legacySessionToken }) => {
      await verifyLegacyUpgradeToken({
        userId,
        deviceId,
        legacySessionToken,
      });

      const user = await usersRepository.findById(userId);
      if (!user) {
        throw toAuthError('Legacy session upgrade failed');
      }

      return await issueSession({
        userId: user.id,
        username: user.username,
        deviceId,
        tokenFactory,
        refreshTokensRepository,
      });
    },

    refresh: async ({ refreshToken, deviceId }) => {
      const payload = await tokenFactory.verifyRefreshToken(refreshToken).catch(() => {
        throw toAuthError('Invalid refresh token');
      });

      const currentTokenHash = tokenFactory.hashRefreshToken(refreshToken);

      const user = await usersRepository.findById(payload.userId);
      if (!user) {
        throw toAuthError('Refresh token user does not exist');
      }

      const tokens = await tokenFactory.issueTokenPair({
        userId: user.id,
        username: user.username,
      });

      try {
        await refreshTokensRepository.rotate({
          currentTokenHash,
          nextTokenHash: tokenFactory.hashRefreshToken(tokens.refreshToken),
          userId: user.id,
          deviceId,
          expiresAt: new Date(tokens.refreshExpiresAt),
        });
      } catch (error) {
        if (error instanceof RefreshTokenReplayError) {
          throw toAuthError('Refresh token replay detected');
        }

        throw error;
      }

      return {
        userId: user.id,
        username: user.username,
        tokens,
      };
    },

    logout: async ({ refreshToken }) => {
      const tokenHash = tokenFactory.hashRefreshToken(refreshToken);
      const existing = await refreshTokensRepository.findByTokenHash(tokenHash);
      if (!existing) {
        return;
      }

      await refreshTokensRepository.revokeById(existing.id);
    },
  };
};
