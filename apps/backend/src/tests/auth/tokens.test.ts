import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthConfig } from '../../config.js';
import { createTokenFactory } from '../../auth/tokens.js';

const baseConfig: AuthConfig = {
  JWT_ISSUER: 'ai-note-keeper',
  JWT_AUDIENCE: 'ai-note-keeper-clients',
  JWT_ACCESS_SECRET: 'access-secret-that-is-at-least-32-characters',
  JWT_REFRESH_SECRET: 'refresh-secret-that-is-at-least-32-characters',
  JWT_ACCESS_TTL_SECONDS: 120,
  JWT_REFRESH_TTL_SECONDS: 300,
};

test('access and refresh token verification reject invalid signature, issuer, and expiry', async () => {
  const factory = createTokenFactory(baseConfig);
  const pair = await factory.issueTokenPair({
    userId: 'user-1',
    username: 'alice',
  });

  const accessPayload = await factory.verifyAccessToken(pair.accessToken);
  assert.equal(accessPayload.userId, 'user-1');
  assert.equal(accessPayload.username, 'alice');

  const refreshPayload = await factory.verifyRefreshToken(pair.refreshToken);
  assert.equal(refreshPayload.userId, 'user-1');
  assert.equal(typeof refreshPayload.tokenId, 'string');

  const wrongSecretFactory = createTokenFactory({
    ...baseConfig,
    JWT_ACCESS_SECRET: 'different-access-secret-with-32-characters',
  });
  await assert.rejects(() => wrongSecretFactory.verifyAccessToken(pair.accessToken));

  const wrongIssuerFactory = createTokenFactory({
    ...baseConfig,
    JWT_ISSUER: 'other-issuer',
  });
  await assert.rejects(() => wrongIssuerFactory.verifyRefreshToken(pair.refreshToken));

  const expiredFactory = createTokenFactory({
    ...baseConfig,
    JWT_ACCESS_TTL_SECONDS: -1,
  } as AuthConfig);

  const expiredPair = await expiredFactory.issueTokenPair({
    userId: 'user-2',
    username: 'bob',
  });

  await assert.rejects(() => expiredFactory.verifyAccessToken(expiredPair.accessToken));
});
