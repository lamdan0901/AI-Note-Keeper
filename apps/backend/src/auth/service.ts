import { AppError } from '../middleware/error-middleware.js';
import { readAuthConfig } from '../config.js';
import { errors as joseErrors, jwtVerify } from 'jose';
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
}>;

export type AuthService = Readonly<{
  register: (
    input: Readonly<{ username: string; password: string; deviceId: string | null }>,
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

  return {
    register: async ({ username, password, deviceId }) => {
      const existing = await usersRepository.findByUsername(username);
      if (existing) {
        throw toConflictError('Username already taken');
      }

      const passwordHash = await hashPasswordArgon2id(password);
      const user = await usersRepository.createUser({ username, passwordHash });

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
