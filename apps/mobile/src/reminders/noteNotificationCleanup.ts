import { deleteNoteScheduleState, type DbLike } from './noteScheduleLedger';
import { deleteNotificationsByReminderId } from './notificationLedger';

type NotificationsModule = typeof import('expo-notifications');
type ReactNativeModule = typeof import('react-native');
type ExpoNotificationsWithDismiss = NotificationsModule & {
  dismissNotificationAsync?: (notificationId: string) => Promise<void>;
};

const tryLoadNotificationsModule = async (): Promise<NotificationsModule | null> => {
  try {
    return (await import('expo-notifications')) as NotificationsModule;
  } catch {
    return null;
  }
};

const tryLoadReactNativeModule = async (): Promise<ReactNativeModule | null> => {
  try {
    return (await import('react-native')) as ReactNativeModule;
  } catch {
    return null;
  }
};

const dismissScheduledAndVisibleNotification = async (noteId: string): Promise<void> => {
  const reactNative = await tryLoadReactNativeModule();

  if (reactNative?.Platform.OS === 'android' && reactNative.NativeModules.ReminderModule?.cancel) {
    reactNative.NativeModules.ReminderModule.cancel(noteId);
    return;
  }

  const Notifications = await tryLoadNotificationsModule();
  if (!Notifications) {
    return;
  }

  await Notifications.cancelScheduledNotificationAsync(noteId);

  const notificationsWithDismiss = Notifications as ExpoNotificationsWithDismiss;
  if (notificationsWithDismiss.dismissNotificationAsync) {
    await notificationsWithDismiss.dismissNotificationAsync(noteId);
  }
};

export const clearNoteNotificationState = async (db: DbLike, noteId: string): Promise<void> => {
  await dismissScheduledAndVisibleNotification(noteId);
  await deleteNoteScheduleState(db, noteId);
  await deleteNotificationsByReminderId(db, noteId);
};
