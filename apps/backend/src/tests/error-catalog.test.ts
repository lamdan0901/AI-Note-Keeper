import assert from 'node:assert/strict';
import test from 'node:test';

import { STATUS_BY_CATEGORY, resolveErrorDefinition } from '../errors/catalog.js';

test('status mapping covers required categories', () => {
  assert.deepStrictEqual(STATUS_BY_CATEGORY, {
    validation: 400,
    auth: 401,
    forbidden: 403,
    not_found: 404,
    conflict: 409,
    rate_limit: 429,
    internal: 500,
  });
});

test('unknown category resolves to internal error definition', () => {
  const resolved = resolveErrorDefinition('something_else');

  assert.deepStrictEqual(resolved, {
    code: 'internal',
    status: 500,
    message: 'Internal server error',
  });
});

test('known categories resolve to mapped status with non-empty message', () => {
  for (const [code, status] of Object.entries(STATUS_BY_CATEGORY) as Array<
    [keyof typeof STATUS_BY_CATEGORY, number]
  >) {
    const resolved = resolveErrorDefinition(code);
    assert.equal(resolved.code, code);
    assert.equal(resolved.status, status);
    assert.match(resolved.message, /\S/);
  }
});
