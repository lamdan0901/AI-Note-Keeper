import { describe, expect, test } from '@jest/globals';
import { getTapDecision } from '../../apps/mobile/src/components/noteCardInteractions';

describe('getTapDecision', () => {
  test('returns open when selection mode is inactive', () => {
    expect(getTapDecision({ selectionModeActive: false })).toBe('open');
  });

  test('returns toggleSelection when selection mode is active', () => {
    expect(getTapDecision({ selectionModeActive: true })).toBe('toggleSelection');
  });
});
