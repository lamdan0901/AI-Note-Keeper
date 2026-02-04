import * as Notifications from "expo-notifications";

export const REMINDER_CHANNEL_ID = "reminders";

export const configureReminderNotifications = async (): Promise<void> => {
  await Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: "Reminders",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#FF6F61",
  });
};
