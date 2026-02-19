import { ConvexHttpClient } from 'convex/browser';
import * as Notifications from 'expo-notifications';
import { getMessaging, getToken } from '@react-native-firebase/messaging';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import uuid from 'react-native-uuid';

import { api } from '../../../../convex/_generated/api';
import { logSyncEvent } from '../reminders/logging';

const DEVICE_ID_KEY = 'DEVICE_UNIQUE_ID';

/**
 * Default userId for this single-user app.
 * Must match the value used when creating notes.
 */
const DEFAULT_USER_ID = 'local-user';

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

const resolveUserId = (override?: string): string => {
  if (override) {
    return override;
  }
  // Direct access – babel inlines this at build time
  const envUser = process.env.EXPO_PUBLIC_USER_ID;
  if (envUser) {
    return envUser;
  }
  return DEFAULT_USER_ID;
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

export const registerDevicePushToken = async (
  options: RegisterDeviceTokenOptions = {},
): Promise<void> => {
  if (Platform.OS !== 'android') {
    logSyncEvent('info', 'push_token_skip_platform', { platform: Platform.OS });
    return;
  }

  logSyncEvent('info', 'push_token_registration_start', {
    hasOverrideUrl: !!options.convexUrl,
    hasOverrideUser: !!options.userId,
  });

  const convexUrl = resolveConvexUrl(options.convexUrl);
  if (!convexUrl) {
    logSyncEvent('error', 'push_token_missing_convex_url', {
      rawEnv: String(process.env.EXPO_PUBLIC_CONVEX_URL ?? 'undefined'),
    });
    return;
  }

  const userId = resolveUserId(options.userId);
  logSyncEvent('info', 'push_token_resolved_user', { userId });

  const permissions = await Notifications.getPermissionsAsync();
  if (!permissions.granted) {
    const requested = await Notifications.requestPermissionsAsync();
    if (!requested.granted) {
      logSyncEvent('warn', 'push_token_permission_denied');
      return;
    }
  }

  const messaging = getMessaging();
  let fcmToken: string;
  try {
    fcmToken = await getToken(messaging);
  } catch (err) {
    logSyncEvent('error', 'push_token_fcm_error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (!fcmToken) {
    logSyncEvent('warn', 'push_token_missing_fcm');
    return;
  }

  const deviceId = await getOrCreateStableDeviceId(options.deviceId);

  try {
    const client = new ConvexHttpClient(convexUrl);
    await client.mutation(api.functions.deviceTokens.upsertDevicePushToken, {
      id: deviceId,
      userId,
      deviceId,
      fcmToken,
      platform: 'android',
      updatedAt: Date.now(),
    });
    logSyncEvent('info', 'push_token_registered', { deviceId, userId });
  } catch (err) {
    logSyncEvent('error', 'push_token_mutation_failed', {
      deviceId,
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
