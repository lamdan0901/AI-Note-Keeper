import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import uuid from 'react-native-uuid';

export const AUTH_SESSION_KEY = 'AUTH_SESSION';
export const DEVICE_ID_KEY = 'DEVICE_UNIQUE_ID';
export const INSTALL_BOOTSTRAP_DONE_KEY = 'INSTALL_BOOTSTRAP_DONE_V1';

const LEGACY_MIGRATION_DONE_KEY = 'LEGACY_MIGRATION_DONE';

export type AuthSession = {
  userId: string;
  username: string;
  accessToken?: string;
  refreshToken?: string;
};

export type LegacyMobileUpgradeSession = {
  userId: string;
  legacySessionToken?: string;
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

export const hasStoredDeviceId = async (): Promise<boolean> => {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  return Boolean(existing && existing.trim().length > 0);
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
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
    };
  } catch {
    return null;
  }
};

export const loadLegacySessionUpgradePayload =
  async (): Promise<LegacyMobileUpgradeSession | null> => {
    try {
      const raw = await SecureStore.getItemAsync(AUTH_SESSION_KEY);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as Partial<AuthSession>;
      if (!parsed.userId || typeof parsed.userId !== 'string') {
        return null;
      }

      if (parsed.username && parsed.username.trim().length > 0) {
        return null;
      }

      return {
        userId: parsed.userId,
        legacySessionToken:
          typeof parsed.accessToken === 'string' && parsed.accessToken.trim().length > 0
            ? parsed.accessToken
            : undefined,
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

export const hasCompletedInstallBootstrap = async (): Promise<boolean> => {
  const raw = await AsyncStorage.getItem(INSTALL_BOOTSTRAP_DONE_KEY);
  return raw === '1';
};

export const markInstallBootstrapCompleted = async (): Promise<void> => {
  await AsyncStorage.setItem(INSTALL_BOOTSTRAP_DONE_KEY, '1');
};

export const clearAnonymousInstallKeys = async (): Promise<void> => {
  await AsyncStorage.removeItem(DEVICE_ID_KEY);
  await AsyncStorage.removeItem(LEGACY_MIGRATION_DONE_KEY);
};
