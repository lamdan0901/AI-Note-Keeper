import { Alert, NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'EXACT_ALARM_PROMPT_LAST_SHOWN';
/** Re-prompt the user every 7 days if they still lack exact alarm permission. */
const RE_PROMPT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export const checkStartupPermissions = async (): Promise<void> => {
  if (Platform.OS !== 'android') {
    return;
  }

  try {
    const { ReminderModule } = NativeModules;
    if (!ReminderModule) {
      return;
    }

    const hasPermission = await ReminderModule.hasExactAlarmPermission();
    if (hasPermission) {
      return;
    }

    // Only re-prompt if enough time has passed since the last prompt
    const lastShown = await AsyncStorage.getItem(STORAGE_KEY);
    if (lastShown) {
      const elapsed = Date.now() - Number(lastShown);
      if (elapsed < RE_PROMPT_INTERVAL_MS) {
        return;
      }
    }

    Alert.alert(
      'Enable Offline Reminders',
      'To ensure alarms fire reliably when the app is closed, we need permission to set exact alarms. Without it, reminders may be delayed or missed.',
      [
        {
          text: 'Not Now',
          style: 'cancel',
          onPress: async () => {
            await AsyncStorage.setItem(STORAGE_KEY, String(Date.now()));
          },
        },
        {
          text: 'Enable',
          onPress: async () => {
            await AsyncStorage.setItem(STORAGE_KEY, String(Date.now()));
            ReminderModule.openExactAlarmSettings();
          },
        },
      ],
    );
  } catch (error) {
    console.warn('[Permissions] Startup check failed:', error);
  }
};
