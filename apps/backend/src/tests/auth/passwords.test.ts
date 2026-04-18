import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { hashPasswordArgon2id, verifyPassword } from '../../auth/passwords.js';

test('new password hashes are argon2id and verify correctly', async () => {
  const hash = await hashPasswordArgon2id('correct horse battery staple');

  assert.equal(hash.startsWith('$argon2id$'), true);

  const result = await verifyPassword('correct horse battery staple', hash);
  assert.deepStrictEqual(result, {
    verified: true,
    needsUpgrade: false,
    algorithm: 'argon2id',
  });
});

test('legacy salt:sha256 credentials validate and report upgrade-needed metadata', async () => {
  const salt = 'legacy-salt';
  const hash = createHash('sha256').update(`${salt}pass-12345`).digest('hex');
  const stored = `${salt}:${hash}`;

  const result = await verifyPassword('pass-12345', stored);
  assert.deepStrictEqual(result, {
    verified: true,
    needsUpgrade: true,
    algorithm: 'legacy-sha256',
  });

  const failed = await verifyPassword('wrong-pass', stored);
  assert.equal(failed.verified, false);
  assert.equal(failed.needsUpgrade, false);
});
