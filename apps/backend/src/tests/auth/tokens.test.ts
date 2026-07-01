import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthConfig, ReminderSchedulerConfig } from '../../config.js';
import { readAuthConfig, readReminderSchedulerConfig } from '../../config.js';
import { createTokenFactory } from '../../auth/tokens.js';

const baseConfig: AuthConfig = {
  JWT_ISSUER: 'ai-note-keeper',
  JWT_AUDIENCE: 'ai-note-keeper-clients',
  JWT_ACCESS_SECRET: 'access-secret-that-is-at-least-32-characters',
  JWT_REFRESH_SECRET: 'refresh-secret-that-is-at-least-32-characters',
  LEGACY_UPGRADE_SECRET: 'legacy-upgrade-secret-at-least-32-char',
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

test('default auth config uses one hour access token lifetime and preserves refresh lifetime', () => {
  const config = readAuthConfig({
    PORT: '3000',
    DATABASE_URL: 'https://example.com/db',
    NODE_ENV: 'development',
  } as NodeJS.ProcessEnv);

  assert.equal(config.JWT_ACCESS_TTL_SECONDS, 3_600);
  assert.equal(config.JWT_REFRESH_TTL_SECONDS, 2_592_000);
});

test('auth config env overrides default access token lifetime', () => {
  const config = readAuthConfig({
    PORT: '3000',
    DATABASE_URL: 'https://example.com/db',
    NODE_ENV: 'development',
    JWT_ACCESS_TTL_SECONDS: '120',
  } as NodeJS.ProcessEnv);

  assert.equal(config.JWT_ACCESS_TTL_SECONDS, 120);
});

test('production scheduler config requires QStash credentials for qstash provider', () => {
  assert.throws(
    () =>
      readReminderSchedulerConfig({
        NODE_ENV: 'production',
        REMINDER_SCHEDULER_PROVIDER: 'qstash',
        REMINDER_SCHEDULER_CALLBACK_BASE_URL: 'https://api.example.test',
        QSTASH_TOKEN: 'qstash-token',
        QSTASH_CURRENT_SIGNING_KEY: 'current-signing-key',
      } as NodeJS.ProcessEnv),
    /QSTASH_NEXT_SIGNING_KEY is required/i,
  );
});

test('qstash scheduler config ignores blank optional QSTASH_URL', () => {
  const config = readReminderSchedulerConfig({
    NODE_ENV: 'production',
    REMINDER_SCHEDULER_PROVIDER: 'qstash',
    REMINDER_SCHEDULER_CALLBACK_BASE_URL: 'https://api.example.test',
    QSTASH_TOKEN: 'qstash-token',
    QSTASH_CURRENT_SIGNING_KEY: 'current-signing-key',
    QSTASH_NEXT_SIGNING_KEY: 'next-signing-key',
    QSTASH_URL: '',
  } as NodeJS.ProcessEnv);

  assert.equal(config.REMINDER_SCHEDULER_PROVIDER, 'qstash');
  assert.equal(config.QSTASH_URL, undefined);
});

test('qstash scheduler config accepts callback base url token and signing keys', () => {
  const config = readReminderSchedulerConfig({
    NODE_ENV: 'production',
    REMINDER_SCHEDULER_PROVIDER: 'qstash',
    REMINDER_SCHEDULER_CALLBACK_BASE_URL: 'https://api.example.test',
    QSTASH_TOKEN: 'qstash-token',
    QSTASH_CURRENT_SIGNING_KEY: 'current-signing-key',
    QSTASH_NEXT_SIGNING_KEY: 'next-signing-key',
  } as NodeJS.ProcessEnv);

  assert.equal(config.REMINDER_SCHEDULER_PROVIDER, 'qstash');
  assert.equal(config.REMINDER_SCHEDULER_CALLBACK_BASE_URL, 'https://api.example.test');
  assert.equal(config.QSTASH_TOKEN, 'qstash-token');
  assert.equal(config.QSTASH_CURRENT_SIGNING_KEY, 'current-signing-key');
  assert.equal(config.QSTASH_NEXT_SIGNING_KEY, 'next-signing-key');
});

test('development scheduler config still defaults disabled provider metadata safely', () => {
  const config = readReminderSchedulerConfig({
    NODE_ENV: 'development',
  } as NodeJS.ProcessEnv) as ReminderSchedulerConfig;

  assert.equal(config.REMINDER_SCHEDULER_PROVIDER, 'disabled');
});
