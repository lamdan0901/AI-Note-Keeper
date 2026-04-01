import { Platform, Vibration } from 'react-native';

export type VoiceHapticEvent = 'listen-start' | 'listen-stop' | 'clarification-prompt';

const HAPTIC_DURATION_MS: Record<VoiceHapticEvent, number> = {
  'listen-start': 12,
  'listen-stop': 8,
  'clarification-prompt': 16,
};

export function triggerVoiceHaptic(event: VoiceHapticEvent): void {
  if (Platform.OS !== 'android') {
    return;
  }

  try {
    Vibration.vibrate(HAPTIC_DURATION_MS[event]);
  } catch {
    // Ignore runtime vibration failures to avoid breaking capture flow.
  }
}