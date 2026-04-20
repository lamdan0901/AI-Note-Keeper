import assert from 'node:assert/strict';
import test from 'node:test';
import { SignJWT } from 'jose';

import { readAuthConfig } from '../../config.js';
import { createAuthService } from '../../auth/service.js';

const createLegacyUpgradeToken = async (
  input: Readonly<{
    userId: string;
    deviceId?: string;
    issuer?: string;
    audience?: string;
    type?: string;
  }>,
): Promise<string> => {
  const authConfig = readAuthConfig();
  const encoder = new TextEncoder();

  const payload: Record<string, string> = {
    type: input.type ?? 'legacy-upgrade',
    userId: input.userId,
  };

  if (input.deviceId) {
    payload.deviceId = input.deviceId;
  }

  const token = new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(input.issuer ?? authConfig.JWT_ISSUER)
    .setAudience(input.audience ?? authConfig.JWT_AUDIENCE)
    .setExpirationTime('5m');

  return await token.sign(encoder.encode(authConfig.LEGACY_UPGRADE_SECRET));
};

const createServiceForUpgradeTests = () => {
  const usersRepository = {
    findByUsername: async () => null,
    findById: async (id: string) => ({
      id,
      username: 'legacy-user',
      passwordHash: 'salt:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    }),
    createUser: async () => {
      throw new Error('Not used in this test');
    },
    updatePasswordHash: async () => {
      throw new Error('Not used in this test');
    },
  };

  const refreshTokensRepository = {
    insert: async () => ({
      id: 'refresh-id',
      userId: 'legacy-user-id',
      tokenHash: 'hash',
      deviceId: 'device-id',
      expiresAt: new Date(Date.now() + 60_000),
      revoked: false,
    }),
    findByTokenHash: async () => null,
    revokeById: async () => undefined,
    rotate: async () => {
      throw new Error('Not used in this test');
    },
  };

  const tokenFactory = {
    issueTokenPair: async () => ({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accessExpiresAt: Date.now() + 60_000,
      refreshExpiresAt: Date.now() + 120_000,
    }),
    verifyAccessToken: async () => {
      throw new Error('Not used in this test');
    },
    verifyRefreshToken: async () => {
      throw new Error('Not used in this test');
    },
    hashRefreshToken: () => 'refresh-token-hash',
  };

  return createAuthService({
    usersRepository,
    refreshTokensRepository,
    tokenFactory,
  });
};

test('upgrade-session rejects tokenless legacy session by default', async () => {
  const previousAllow = process.env.ALLOW_LEGACY_USERID_UPGRADE_WITHOUT_TOKEN;
  const previousUntil = process.env.LEGACY_USERID_UPGRADE_TOKENLESS_UNTIL;
  const previousAllowProd = process.env.ALLOW_LEGACY_USERID_UPGRADE_WITHOUT_TOKEN_IN_PRODUCTION;

  delete process.env.ALLOW_LEGACY_USERID_UPGRADE_WITHOUT_TOKEN;
  delete process.env.LEGACY_USERID_UPGRADE_TOKENLESS_UNTIL;
  delete process.env.ALLOW_LEGACY_USERID_UPGRADE_WITHOUT_TOKEN_IN_PRODUCTION;

  const authService = createServiceForUpgradeTests();

  try {
    await assert.rejects(() =>
      authService.upgradeSession({
        userId: 'legacy-user-id',
        legacySessionToken: undefined,
        deviceId: 'device-id',
      }),
    );
  } finally {
    process.env.ALLOW_LEGACY_USERID_UPGRADE_WITHOUT_TOKEN = previousAllow;
    process.env.LEGACY_USERID_UPGRADE_TOKENLESS_UNTIL = previousUntil;
    process.env.ALLOW_LEGACY_USERID_UPGRADE_WITHOUT_TOKEN_IN_PRODUCTION = previousAllowProd;
  }
});

test('upgrade-session allows tokenless legacy session only inside explicit migration window', async () => {
  const previousAllow = process.env.ALLOW_LEGACY_USERID_UPGRADE_WITHOUT_TOKEN;
  const previousUntil = process.env.LEGACY_USERID_UPGRADE_TOKENLESS_UNTIL;
  const previousAllowProd = process.env.ALLOW_LEGACY_USERID_UPGRADE_WITHOUT_TOKEN_IN_PRODUCTION;
  const previousNodeEnv = process.env.NODE_ENV;

  process.env.ALLOW_LEGACY_USERID_UPGRADE_WITHOUT_TOKEN = 'true';
  process.env.LEGACY_USERID_UPGRADE_TOKENLESS_UNTIL = new Date(Date.now() + 60_000).toISOString();
  process.env.ALLOW_LEGACY_USERID_UPGRADE_WITHOUT_TOKEN_IN_PRODUCTION = 'true';
  process.env.NODE_ENV = 'production';

  const authService = createServiceForUpgradeTests();

  try {
    const result = await authService.upgradeSession({
      userId: 'legacy-user-id',
      legacySessionToken: undefined,
      deviceId: 'device-id',
    });

    assert.equal(result.userId, 'legacy-user-id');
    assert.equal(result.username, 'legacy-user');
    assert.equal(typeof result.tokens.accessToken, 'string');
  } finally {
    process.env.ALLOW_LEGACY_USERID_UPGRADE_WITHOUT_TOKEN = previousAllow;
    process.env.LEGACY_USERID_UPGRADE_TOKENLESS_UNTIL = previousUntil;
    process.env.ALLOW_LEGACY_USERID_UPGRADE_WITHOUT_TOKEN_IN_PRODUCTION = previousAllowProd;
    process.env.NODE_ENV = previousNodeEnv;
  }
});

test('upgrade-session rejects tokenless legacy session in production without explicit production override', async () => {
  const previousAllow = process.env.ALLOW_LEGACY_USERID_UPGRADE_WITHOUT_TOKEN;
  const previousUntil = process.env.LEGACY_USERID_UPGRADE_TOKENLESS_UNTIL;
  const previousAllowProd = process.env.ALLOW_LEGACY_USERID_UPGRADE_WITHOUT_TOKEN_IN_PRODUCTION;
  const previousNodeEnv = process.env.NODE_ENV;

  process.env.ALLOW_LEGACY_USERID_UPGRADE_WITHOUT_TOKEN = 'true';
  process.env.LEGACY_USERID_UPGRADE_TOKENLESS_UNTIL = new Date(Date.now() + 60_000).toISOString();
  delete process.env.ALLOW_LEGACY_USERID_UPGRADE_WITHOUT_TOKEN_IN_PRODUCTION;
  process.env.NODE_ENV = 'production';

  const authService = createServiceForUpgradeTests();

  try {
    await assert.rejects(() =>
      authService.upgradeSession({
        userId: 'legacy-user-id',
        legacySessionToken: undefined,
        deviceId: 'device-id',
      }),
    );
  } finally {
    process.env.ALLOW_LEGACY_USERID_UPGRADE_WITHOUT_TOKEN = previousAllow;
    process.env.LEGACY_USERID_UPGRADE_TOKENLESS_UNTIL = previousUntil;
    process.env.ALLOW_LEGACY_USERID_UPGRADE_WITHOUT_TOKEN_IN_PRODUCTION = previousAllowProd;
    process.env.NODE_ENV = previousNodeEnv;
  }
});

test('upgrade-session accepts signed legacy upgrade token with matching user and device', async () => {
  const authService = createServiceForUpgradeTests();
  const legacySessionToken = await createLegacyUpgradeToken({
    userId: 'legacy-user-id',
    deviceId: 'device-id',
  });

  const result = await authService.upgradeSession({
    userId: 'legacy-user-id',
    legacySessionToken,
    deviceId: 'device-id',
  });

  assert.equal(result.userId, 'legacy-user-id');
  assert.equal(result.username, 'legacy-user');
});

test('upgrade-session rejects signed legacy token when token device does not match request device', async () => {
  const authService = createServiceForUpgradeTests();
  const legacySessionToken = await createLegacyUpgradeToken({
    userId: 'legacy-user-id',
    deviceId: 'device-id',
  });

  await assert.rejects(() =>
    authService.upgradeSession({
      userId: 'legacy-user-id',
      legacySessionToken,
      deviceId: null,
    }),
  );
});

test('upgrade-session rejects signed legacy token with wrong issuer', async () => {
  const authService = createServiceForUpgradeTests();
  const legacySessionToken = await createLegacyUpgradeToken({
    userId: 'legacy-user-id',
    deviceId: 'device-id',
    issuer: 'invalid-issuer',
  });

  await assert.rejects(() =>
    authService.upgradeSession({
      userId: 'legacy-user-id',
      legacySessionToken,
      deviceId: 'device-id',
    }),
  );
});
