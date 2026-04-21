import { describe, expect, it } from 'vitest';

import { getNotesPrincipalKey } from '../src/services/notes';

describe('notes auth scope key', () => {
  it('uses auth scope for signed-in users', () => {
    expect(getNotesPrincipalKey(true, 'user-123')).toBe('auth:user-123');
  });

  it('uses guest scope for signed-out users', () => {
    expect(getNotesPrincipalKey(false, 'web-guest-123')).toBe('guest:web-guest-123');
  });

  it('falls back to unknown when user id is empty', () => {
    expect(getNotesPrincipalKey(true, '')).toBe('auth:unknown');
    expect(getNotesPrincipalKey(false, undefined)).toBe('guest:unknown');
  });
});
