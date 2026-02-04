import { AppRegistry } from 'react-native';
import { handleFcmMessage, FcmRemoteMessage } from './fcmMessageHandler';
import { logSyncEvent } from '../reminders/logging';

const HEADLESS_TASK_NAME = 'ReminderSyncFCM';

type HeadlessTaskPayload = FcmRemoteMessage & {
  [key: string]: unknown;
};

/**
 * Headless task for processing FCM data messages when app is killed.
 * React Native Firebase calls this for data-only messages.
 */
const headlessTask = async (payload?: HeadlessTaskPayload): Promise<void> => {
  logSyncEvent('info', 'fcm_headless_task_started', {
    messageId: payload?.messageId,
    type: payload?.data?.type,
  });

  if (!payload) {
    logSyncEvent('warn', 'fcm_headless_task_no_payload');
    return;
  }

  try {
    await handleFcmMessage(payload);
    logSyncEvent('info', 'fcm_headless_task_completed', {
      messageId: payload.messageId,
    });
  } catch (error) {
    logSyncEvent('error', 'fcm_headless_task_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const registerFcmHeadlessTask = (): void => {
  AppRegistry.registerHeadlessTask(HEADLESS_TASK_NAME, () => headlessTask);
};

export const fcmHeadlessTaskName = HEADLESS_TASK_NAME;
