import { describe, expect, it } from '@jest/globals';
import {
  buildClarificationTurnLabel,
  buildVoiceOverlayAccessibilityLabel,
  canSubmitClarificationAnswer,
  isVoiceHoldEnabled,
} from '../../src/voice/ui/voiceUiHelpers';

describe('voice ui helpers', () => {
  it('enables hold-to-talk only for android with feature flag enabled', () => {
    expect(
      isVoiceHoldEnabled({
        platformOs: 'android',
        voiceCaptureEnabled: true,
      }),
    ).toBe(true);

    expect(
      isVoiceHoldEnabled({
        platformOs: 'ios',
        voiceCaptureEnabled: true,
      }),
    ).toBe(false);

    expect(
      isVoiceHoldEnabled({
        platformOs: 'android',
        voiceCaptureEnabled: false,
      }),
    ).toBe(false);
  });

  it('returns state-specific accessibility labels for overlay', () => {
    expect(buildVoiceOverlayAccessibilityLabel('listening')).toBe('Voice recording in progress');
    expect(buildVoiceOverlayAccessibilityLabel('processing')).toBe('Processing voice note');
    expect(buildVoiceOverlayAccessibilityLabel('processing', 'Resolving clarification')).toBe(
      'Resolving clarification',
    );
    expect(buildVoiceOverlayAccessibilityLabel('error')).toBe('Voice capture error');
    expect(buildVoiceOverlayAccessibilityLabel('error', undefined, 'permission-denied')).toBe(
      'Microphone permission denied',
    );
  });

  it('normalizes clarification turn label bounds', () => {
    expect(buildClarificationTurnLabel(2, 3)).toBe('Clarification 2 of 3');
    expect(buildClarificationTurnLabel(0, 0)).toBe('Clarification 1 of 1');
  });

  it('allows submit only for non-empty answer when not submitting', () => {
    expect(canSubmitClarificationAnswer('next monday at 9', false)).toBe(true);
    expect(canSubmitClarificationAnswer('   ', false)).toBe(false);
    expect(canSubmitClarificationAnswer('answer', true)).toBe(false);
  });
});
