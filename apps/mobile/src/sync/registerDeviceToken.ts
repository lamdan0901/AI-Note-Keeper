import * as Notifications from 'expo-notifications';
import { getMessaging, getToken } from '@react-native-firebase/messaging';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import uuid from 'react-native-uuid';

import { createConvexBackendClient } from '../../../../packages/shared/backend/convex';
import { logSyncEvent } from '../reminders/logging';
import { resolveCurrentUserId } from '../auth/session';

const DEVICE_ID_KEY = 'DEVICE_UNIQUE_ID';
const PUSH_PERMISSION_DENIED_LOG_TS_KEY = 'PUSH_PERMISSION_DENIED_LOG_TS';
const PUSH_PERMISSION_DENIED_LOG_INTERVAL_MS = 24 * 60 * 60 * 1000;

type RegisterDeviceTokenOptions = {
  convexUrl?: string;
  userId?: string;
  deviceId?: string;
};

/**
 * IMPORTANT: Access `process.env.EXPO_PUBLIC_*` directly (no optional
 * chaining on `process.env`). Expo's babel transform only recognises
 * the exact pattern `process.env.VARIABLE_NAME` and replaces it with
 * the literal value at build time. Using `process.env?.VARIABLE_NAME`
 * creates an OptionalMemberExpression AST node that the babel plugin
 * does NOT match, leaving the var undefined at runtime in APK builds.
 */
const resolveConvexUrl = (override?: string): string | null => {
  if (override) {
    return override;
  }
  // Direct access – babel inlines this at build time
  const envUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
  if (envUrl) {
    return envUrl;
  }
  return null;
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

  const convexUrl = resolveConvexUrl(options.convexUrl);
  console.log('[PushToken] Resolved Convex URL:', convexUrl ?? 'NULL');
  if (!convexUrl) {
    console.warn(
      '[PushToken] ABORT: No Convex URL. Env value:',
      String(process.env.EXPO_PUBLIC_CONVEX_URL ?? 'undefined'),
    );
    logSyncEvent('warn', 'push_token_missing_convex_url', {
      rawEnv: String(process.env.EXPO_PUBLIC_CONVEX_URL ?? 'undefined'),
    });
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
    console.log(
      '[PushToken] FCM token obtained:',
      fcmToken ? `${fcmToken.slice(0, 20)}...` : 'EMPTY',
    );
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
    const client = createConvexBackendClient(convexUrl);
    if (!client) {
      console.warn('[PushToken] ABORT: Failed to create backend client');
      logSyncEvent('warn', 'push_token_missing_convex_url', {});
      return;
    }
    console.log('[PushToken] Calling upsertDevicePushToken mutation...');
    await client.upsertDevicePushToken({
      id: deviceId,
      userId,
      deviceId,
      fcmToken,
      platform: 'android',
      updatedAt: Date.now(),
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
