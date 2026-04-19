import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('react-native-uuid', () => ({
  v4: jest.fn(() => 'generated-device-id'),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as sessionModule from '../../src/auth/session';
import {
  AUTH_SESSION_KEY,
  DEVICE_ID_KEY,
  clearAuthSession,
  getOrCreateDeviceId,
  loadLegacySessionUpgradePayload,
  loadAuthSession,
  resolveCurrentUserId,
  saveAuthSession,
} from '../../src/auth/session';

describe('auth session lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.EXPO_PUBLIC_DEVICE_ID;
  });

  it('uses env device id when present', async () => {
    process.env.EXPO_PUBLIC_DEVICE_ID = 'env-device-id';

    const id = await getOrCreateDeviceId();

    expect(id).toBe('env-device-id');
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });

  it('does not expose legacy migration key constant', () => {
    expect('LEGACY_MIGRATION_DONE_KEY' in sessionModule).toBe(false);
  });

  it('returns stored device id when found', async () => {
    (AsyncStorage.getItem as any).mockResolvedValue('stored-device-id');

    const id = await getOrCreateDeviceId();

    expect(AsyncStorage.getItem).toHaveBeenCalledWith(DEVICE_ID_KEY);
    expect(id).toBe('stored-device-id');
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('generates and stores new device id when missing', async () => {
    (AsyncStorage.getItem as any).mockResolvedValue(null);

    const id = await getOrCreateDeviceId();

    expect(id).toBe('generated-device-id');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(DEVICE_ID_KEY, 'generated-device-id');
  });

  it('falls back to generated id when storage fails', async () => {
    (AsyncStorage.getItem as any).mockRejectedValue(new Error('storage down'));

    const id = await getOrCreateDeviceId();

    expect(id).toBe('generated-device-id');
  });

  it('loads valid auth session', async () => {
    (SecureStore.getItemAsync as any).mockResolvedValue(
      JSON.stringify({
        userId: 'u1',
        username: 'alice',
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
      }),
    );

    const session = await loadAuthSession();

    expect(session).toEqual({
      userId: 'u1',
      username: 'alice',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    });
  });

  it('reads legacy userId-only payload for silent upgrade path', async () => {
    (SecureStore.getItemAsync as any).mockResolvedValue(JSON.stringify({ userId: 'legacy-user' }));

    await expect(loadAuthSession()).resolves.toBeNull();
    await expect(loadLegacySessionUpgradePayload()).resolves.toEqual({
      userId: 'legacy-user',
      legacySessionToken: undefined,
    });
  });

  it('returns null for invalid auth session payload', async () => {
    (SecureStore.getItemAsync as any).mockResolvedValue('{bad-json');

    const session = await loadAuthSession();

    expect(session).toBeNull();
  });

  it('persists and clears auth session', async () => {
    await saveAuthSession({ userId: 'u2', username: 'bob' });
    await clearAuthSession();

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      AUTH_SESSION_KEY,
      JSON.stringify({ userId: 'u2', username: 'bob' }),
    );
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(AUTH_SESSION_KEY);
  });

  it('resolves current user id from session first', async () => {
    (SecureStore.getItemAsync as any).mockResolvedValue(
      JSON.stringify({ userId: 'auth-user-id', username: 'alice' }),
    );

    const userId = await resolveCurrentUserId();

    expect(userId).toBe('auth-user-id');
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });

  it('resolves current user id from device id when no session', async () => {
    (SecureStore.getItemAsync as any).mockResolvedValue(null);
    (AsyncStorage.getItem as any).mockResolvedValue('device-only-id');

    const userId = await resolveCurrentUserId();

    expect(userId).toBe('device-only-id');
  });

  it('falls back to device id for malformed session payload', async () => {
    (SecureStore.getItemAsync as any).mockResolvedValue(JSON.stringify({ userId: 'u1' }));
    (AsyncStorage.getItem as any).mockResolvedValue('device-only-id');

    const userId = await resolveCurrentUserId();

    expect(userId).toBe('device-only-id');
  });
});
