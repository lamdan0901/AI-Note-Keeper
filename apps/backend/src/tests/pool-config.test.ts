import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isLocalDatabaseHost,
  isRemoteDatabaseUrl,
  isTransientDbConnectionError,
  resolveConnectionTimeoutMillis,
  resolvePoolOptions,
  resolveQueryRetryAttempts,
  resolveQueryRetryDelayMs,
} from '../db/pool.js';

test('isLocalDatabaseHost recognizes loopback hosts', () => {
  assert.equal(isLocalDatabaseHost('localhost'), true);
  assert.equal(isLocalDatabaseHost('127.0.0.1'), true);
  assert.equal(isLocalDatabaseHost('::1'), true);
  assert.equal(isLocalDatabaseHost('ep-example.neon.tech'), false);
});

test('resolveConnectionTimeoutMillis defaults to 10s for remote databases', () => {
  const previousVercel = process.env.VERCEL;
  const previousConfigured = process.env.DB_CONNECTION_TIMEOUT_MS;

  delete process.env.VERCEL;
  delete process.env.DB_CONNECTION_TIMEOUT_MS;

  try {
    assert.equal(
      resolveConnectionTimeoutMillis('postgresql://user:pass@ep-example.neon.tech/db'),
      10_000,
    );
    assert.equal(
      resolveConnectionTimeoutMillis('postgresql://postgres:postgres@localhost:5432/db'),
      2_000,
    );
  } finally {
    if (previousVercel === undefined) {
      delete process.env.VERCEL;
    } else {
      process.env.VERCEL = previousVercel;
    }

    if (previousConfigured === undefined) {
      delete process.env.DB_CONNECTION_TIMEOUT_MS;
    } else {
      process.env.DB_CONNECTION_TIMEOUT_MS = previousConfigured;
    }
  }
});

test('isRemoteDatabaseUrl treats loopback hosts as local', () => {
  assert.equal(
    isRemoteDatabaseUrl('postgresql://postgres:postgres@localhost:5432/db'),
    false,
  );
  assert.equal(
    isRemoteDatabaseUrl('postgresql://user:pass@ep-example.neon.tech/db'),
    true,
  );
});

test('resolveQueryRetryAttempts defaults to 3 for remote databases', () => {
  const previousConfigured = process.env.DB_QUERY_RETRY_ATTEMPTS;

  delete process.env.DB_QUERY_RETRY_ATTEMPTS;

  try {
    assert.equal(
      resolveQueryRetryAttempts('postgresql://user:pass@ep-example.neon.tech/db'),
      3,
    );
    assert.equal(
      resolveQueryRetryAttempts('postgresql://postgres:postgres@localhost:5432/db'),
      1,
    );
  } finally {
    if (previousConfigured === undefined) {
      delete process.env.DB_QUERY_RETRY_ATTEMPTS;
    } else {
      process.env.DB_QUERY_RETRY_ATTEMPTS = previousConfigured;
    }
  }
});

test('resolvePoolOptions tunes remote pools for managed Postgres', () => {
  const previousConfigured = process.env.DB_CONNECTION_TIMEOUT_MS;

  delete process.env.DB_CONNECTION_TIMEOUT_MS;

  try {
    const remote = resolvePoolOptions('postgresql://user:pass@ep-example.neon.tech/db');
    const local = resolvePoolOptions('postgresql://postgres:postgres@localhost:5432/db');

    assert.equal(remote.max, 10);
    assert.equal(remote.idleTimeoutMillis, 10_000);
    assert.equal(remote.keepAlive, true);
    assert.equal(remote.maxUses, 750);
    assert.equal(remote.connectionTimeoutMillis, 10_000);

    assert.equal(local.max, 20);
    assert.equal(local.idleTimeoutMillis, 30_000);
    assert.equal(local.keepAlive, undefined);
    assert.equal(local.connectionTimeoutMillis, 2_000);
  } finally {
    if (previousConfigured === undefined) {
      delete process.env.DB_CONNECTION_TIMEOUT_MS;
    } else {
      process.env.DB_CONNECTION_TIMEOUT_MS = previousConfigured;
    }
  }
});

test('resolveQueryRetryDelayMs uses exponential backoff capped at 3s', () => {
  assert.equal(resolveQueryRetryDelayMs(1), 500);
  assert.equal(resolveQueryRetryDelayMs(2), 1_000);
  assert.equal(resolveQueryRetryDelayMs(3), 2_000);
  assert.equal(resolveQueryRetryDelayMs(4), 3_000);
});

test('isTransientDbConnectionError recognizes Neon connection timeout failures', () => {
  const error = new Error('Connection terminated due to connection timeout', {
    cause: new Error('Connection terminated unexpectedly'),
  });

  assert.equal(isTransientDbConnectionError(error), true);
  assert.equal(isTransientDbConnectionError(new Error('syntax error at or near "SELECT"')), false);
});