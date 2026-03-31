const FLAG_TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function isFlagEnabled(raw: string | undefined): boolean {
  if (!raw) {
    return false;
  }

  return FLAG_TRUE_VALUES.has(raw.trim().toLowerCase());
}

export function isMobileNotesRealtimeV1Enabled(): boolean {
  // Existing rollout behavior remains enabled until explicitly changed.
  return true;
}

export function isMobileVoiceCaptureV1Enabled(): boolean {
  // Direct env access keeps Expo's compile-time env replacement working reliably.
  return isFlagEnabled(process.env.EXPO_PUBLIC_MOBILE_VOICE_CAPTURE_V1);
}

export function isMobileVoiceClarificationV1Enabled(): boolean {
  // Direct env access keeps Expo's compile-time env replacement working reliably.
  return isFlagEnabled(process.env.EXPO_PUBLIC_MOBILE_VOICE_CLARIFICATION_V1);
}
