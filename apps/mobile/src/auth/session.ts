import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import uuid from 'react-native-uuid';

export const AUTH_SESSION_KEY = 'AUTH_SESSION';
export const DEVICE_ID_KEY = 'DEVICE_UNIQUE_ID';
export const LEGACY_MIGRATION_DONE_KEY = 'LEGACY_MIGRATION_DONE';

export type AuthSession = {
  userId: string;
  username: string;
};

export const getOrCreateDeviceId = async (): Promise<string> => {
  const envDeviceId = process.env.EXPO_PUBLIC_DEVICE_ID;
  if (envDeviceId) return envDeviceId;

  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;

    const newId = String(uuid.v4());
    await AsyncStorage.setItem(DEVICE_ID_KEY, newId);
    return newId;
  } catch {
    return String(uuid.v4());
  }
};

export const loadAuthSession = async (): Promise<AuthSession | null> => {
  try {
    const raw = await SecureStore.getItemAsync(AUTH_SESSION_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (!parsed.userId || !parsed.username) return null;

    return {
      userId: parsed.userId,
      username: parsed.username,
    };
  } catch {
    return null;
  }
};

export const saveAuthSession = async (session: AuthSession): Promise<void> => {
  await SecureStore.setItemAsync(AUTH_SESSION_KEY, JSON.stringify(session));
};

export const clearAuthSession = async (): Promise<void> => {
  await SecureStore.deleteItemAsync(AUTH_SESSION_KEY);
};

export const resolveCurrentUserId = async (): Promise<string> => {
  const session = await loadAuthSession();
  if (session?.userId) {
    return session.userId;
  }
  return getOrCreateDeviceId();
};
