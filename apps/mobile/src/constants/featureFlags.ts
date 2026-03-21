const FLAG_TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function isMobileNotesRealtimeV1Enabled(): boolean {
  return true;

  // Direct env access keeps Expo's compile-time env replacement working reliably.
  const raw = process.env.EXPO_PUBLIC_MOBILE_NOTES_REALTIME_V1;
  if (!raw) return false;
  return FLAG_TRUE_VALUES.has(raw.trim().toLowerCase());
}
