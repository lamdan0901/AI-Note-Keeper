import { ConvexHttpClient } from 'convex/browser';
import * as Notifications from 'expo-notifications';
import { getMessaging, getToken } from '@react-native-firebase/messaging';
import { Platform } from 'react-native';

import { api } from '../../../../convex/_generated/api';
import { logSyncEvent } from '../reminders/logging';

type RegisterDeviceTokenOptions = {
  convexUrl?: string;
  userId?: string;
  deviceId?: string;
};

const resolveConvexUrl = (override?: string): string | null => {
  if (override) {
    return override;
  }
  if (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_CONVEX_URL) {
    return process.env.EXPO_PUBLIC_CONVEX_URL;
  }
  return null;
};

const resolveUserId = (override?: string): string | null => {
  if (override) {
    return override;
  }
  if (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_USER_ID) {
    return process.env.EXPO_PUBLIC_USER_ID;
  }
  return null;
};

const resolveDeviceId = (token: string, override?: string): string => {
  if (override) {
    return override;
  }
  if (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_DEVICE_ID) {
    return process.env.EXPO_PUBLIC_DEVICE_ID;
  }
  return token;
};

export const registerDevicePushToken = async (
  options: RegisterDeviceTokenOptions = {},
): Promise<void> => {
  if (Platform.OS !== 'android') {
    logSyncEvent('info', 'push_token_skip_platform', { platform: Platform.OS });
    return;
  }

  const convexUrl = resolveConvexUrl(options.convexUrl);
  if (!convexUrl) {
    logSyncEvent('warn', 'push_token_missing_convex_url');
    return;
  }

  const userId = resolveUserId(options.userId);
  if (!userId) {
    logSyncEvent('warn', 'push_token_missing_user_id');
    return;
  }

  const permissions = await Notifications.getPermissionsAsync();
  if (!permissions.granted) {
    const requested = await Notifications.requestPermissionsAsync();
    if (!requested.granted) {
      logSyncEvent('warn', 'push_token_permission_denied');
      return;
    }
  }

  const messaging = getMessaging();
  const fcmToken = await getToken(messaging);
  if (!fcmToken) {
    logSyncEvent('warn', 'push_token_missing_fcm');
    return;
  }

  const deviceId = resolveDeviceId(fcmToken, options.deviceId);
  const client = new ConvexHttpClient(convexUrl);

  await client.mutation(api.functions.deviceTokens.upsertDevicePushToken, {
    id: deviceId,
    userId,
    deviceId,
    fcmToken,
    platform: 'android',
    updatedAt: Date.now(),
  });

  logSyncEvent('info', 'push_token_registered', { deviceId });
};
