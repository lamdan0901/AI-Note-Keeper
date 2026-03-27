import { describe, expect, test } from '@jest/globals';

import { resolveMergeResolution } from '../../packages/shared/auth/userDataMerge';

describe('resolveMergeResolution', () => {
  test('prefers cloud when source is sample-only', () => {
    expect(
      resolveMergeResolution({
        sourceEmpty: false,
        sourceSampleOnly: true,
        targetEmpty: false,
        hasConflicts: false,
        sourceCounts: { notes: 1, subscriptions: 0, tokens: 0, events: 0 },
        targetCounts: { notes: 3, subscriptions: 1, tokens: 0, events: 0 },
      }),
    ).toBe('cloud');
  });

  test('prefers local when target is empty', () => {
    expect(
      resolveMergeResolution({
        sourceEmpty: false,
        sourceSampleOnly: false,
        targetEmpty: true,
        hasConflicts: false,
        sourceCounts: { notes: 2, subscriptions: 1, tokens: 0, events: 0 },
        targetCounts: { notes: 0, subscriptions: 0, tokens: 0, events: 0 },
      }),
    ).toBe('local');
  });

  test('prompts when both sides contain meaningful data', () => {
    expect(
      resolveMergeResolution({
        sourceEmpty: false,
        sourceSampleOnly: false,
        targetEmpty: false,
        hasConflicts: true,
        sourceCounts: { notes: 2, subscriptions: 1, tokens: 0, events: 0 },
        targetCounts: { notes: 1, subscriptions: 1, tokens: 0, events: 0 },
      }),
    ).toBe('prompt');
  });
});
