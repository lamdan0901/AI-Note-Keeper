import assert from 'node:assert/strict';
import test from 'node:test';

import { createHealthStatus } from '../health.js';

test('createHealthStatus returns a healthy backend payload', () => {
  assert.deepStrictEqual(createHealthStatus(), {
    ok: true,
    service: 'backend',
  });
});
