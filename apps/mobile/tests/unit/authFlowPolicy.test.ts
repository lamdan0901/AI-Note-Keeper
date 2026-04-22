import { describe, expect, it } from '@jest/globals';

import { resolveLocalDataAction } from '../../src/auth/authFlowPolicy';

describe('mobile auth flow local data policy', () => {
  it('preserves local device data on login', () => {
    expect(resolveLocalDataAction({ flowLabel: 'login' })).toBe('preserve');
  });

  it('migrates local device data into a newly registered account', () => {
    expect(resolveLocalDataAction({ flowLabel: 'register' })).toBe('migrate');
  });

  it('clears local source data when merge chooses cloud', () => {
    expect(resolveLocalDataAction({ flowLabel: 'merge', strategy: 'cloud' })).toBe('clear');
  });

  it('migrates local source data when merge chooses local', () => {
    expect(resolveLocalDataAction({ flowLabel: 'merge', strategy: 'local' })).toBe('migrate');
  });

  it('migrates local source data when merge chooses both', () => {
    expect(resolveLocalDataAction({ flowLabel: 'merge', strategy: 'both' })).toBe('migrate');
  });

  it('fails fast if merge flow is missing a strategy', () => {
    expect(() => resolveLocalDataAction({ flowLabel: 'merge' })).toThrow(
      'Merge strategy is required for merge flow',
    );
  });
});
