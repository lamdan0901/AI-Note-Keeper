import * as Notifications from 'expo-notifications';
import { getMessaging, getToken } from '@react-native-firebase/messaging';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import uuid from 'react-native-uuid';

import { logSyncEvent } from '../reminders/logging';
import { resolveCurrentUserId } from '../auth/session';
import { createDefaultMobileApiClient } from '../api/httpClient';

const DEVICE_ID_KEY = 'DEVICE_UNIQUE_ID';
const PUSH_PERMISSION_DENIED_LOG_TS_KEY = 'PUSH_PERMISSION_DENIED_LOG_TS';
const PUSH_PERMISSION_DENIED_LOG_INTERVAL_MS = 24 * 60 * 60 * 1000;

type RegisterDeviceTokenOptions = {
  userId?: string;
  deviceId?: string;
};

const resolveUserId = async (override?: string): Promise<string> => {
  if (override) {
    return override;
  }
  return await resolveCurrentUserId();
};

/**
 * Get or create a stable device ID persisted in AsyncStorage.
 * This ensures token rotation doesn't create orphaned records in
 * the devicePushTokens table on the server.
 */
const getOrCreateStableDeviceId = async (override?: string): Promise<string> => {
  if (override) {
    return override;
  }
  // Direct access – babel inlines this at build time
  const envDeviceId = process.env.EXPO_PUBLIC_DEVICE_ID;
  if (envDeviceId) {
    return envDeviceId;
  }
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing) {
      return existing;
    }
    const newId = String(uuid.v4());
    await AsyncStorage.setItem(DEVICE_ID_KEY, newId);
    return newId;
  } catch {
    // If AsyncStorage fails, generate a fresh UUID (won't persist but
    // is still better than using the FCM token as ID).
    return String(uuid.v4());
  }
};

const shouldEmitDeniedPermissionWarning = async (): Promise<boolean> => {
  try {
    const lastLoggedAtRaw = await AsyncStorage.getItem(PUSH_PERMISSION_DENIED_LOG_TS_KEY);
    const lastLoggedAt = lastLoggedAtRaw ? Number(lastLoggedAtRaw) : 0;
    if (lastLoggedAt && Date.now() - lastLoggedAt < PUSH_PERMISSION_DENIED_LOG_INTERVAL_MS) {
      return false;
    }
    await AsyncStorage.setItem(PUSH_PERMISSION_DENIED_LOG_TS_KEY, String(Date.now()));
    return true;
  } catch {
    // If AsyncStorage is unavailable, keep previous behavior and emit the warning.
    return true;
  }
};

export const registerDevicePushToken = async (
  options: RegisterDeviceTokenOptions = {},
): Promise<void> => {
  if (Platform.OS !== 'android') {
    logSyncEvent('info', 'push_token_skip_platform', { platform: Platform.OS });
    return;
  }

  console.log('[PushToken] ===== Registration START =====');

  if (!process.env.EXPO_PUBLIC_API_BASE_URL && !process.env.EXPO_PUBLIC_AUTH_API_URL) {
    console.warn('[PushToken] ABORT: Missing API base URL');
    logSyncEvent('warn', 'push_token_missing_api_base_url');
    return;
  }

  const userId = await resolveUserId(options.userId);
  console.log('[PushToken] UserId:', userId);

  const permissions = await Notifications.getPermissionsAsync();
  console.log(
    '[PushToken] Permission status:',
    permissions.status,
    'granted:',
    permissions.granted,
  );
  if (!permissions.granted) {
    const requested = await Notifications.requestPermissionsAsync();
    console.log(
      '[PushToken] Requested permission:',
      requested.status,
      'granted:',
      requested.granted,
    );
    if (!requested.granted) {
      const shouldWarn = await shouldEmitDeniedPermissionWarning();
      if (shouldWarn) {
        console.warn('[PushToken] ABORT: Permission denied');
        logSyncEvent('warn', 'push_token_permission_denied');
      } else {
        console.log('[PushToken] SKIP: Permission denied (warning throttled)');
        logSyncEvent('info', 'push_token_permission_denied_throttled');
      }
      return;
    }
  }

  const messaging = getMessaging();
  let fcmToken: string;
  try {
    fcmToken = await getToken(messaging);
    console.log('[PushToken] FCM token obtained:', fcmToken ? 'present' : 'EMPTY');
  } catch (err) {
    console.warn(
      '[PushToken] ABORT: FCM getToken error:',
      err instanceof Error ? err.message : String(err),
    );
    logSyncEvent('error', 'push_token_fcm_error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (!fcmToken) {
    console.warn('[PushToken] ABORT: FCM token is empty');
    logSyncEvent('warn', 'push_token_missing_fcm');
    return;
  }

  const deviceId = await getOrCreateStableDeviceId(options.deviceId);
  console.log('[PushToken] DeviceId:', deviceId);

  try {
    const client = createDefaultMobileApiClient();
    console.log('[PushToken] Calling POST /api/device-tokens...');
    await client.requestJson('/api/device-tokens', {
      method: 'POST',
      body: {
        deviceId,
        fcmToken,
        platform: 'android',
      },
    });
    console.log('[PushToken] ===== Registration SUCCESS =====');
    logSyncEvent('info', 'push_token_registered', { deviceId, userId });
  } catch (err) {
    console.warn(
      '[PushToken] ===== Registration FAILED =====',
      err instanceof Error ? err.message : String(err),
    );
    logSyncEvent('error', 'push_token_mutation_failed', {
      deviceId,
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
