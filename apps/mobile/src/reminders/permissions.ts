import { Alert, NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'HAS_SEEN_OFFLINE_PERMISSION_PROMPT';

export const checkStartupPermissions = async (): Promise<void> => {
  if (Platform.OS !== 'android') {
    return;
  }

  try {
    const hasSeen = await AsyncStorage.getItem(STORAGE_KEY);
    if (hasSeen === 'true') {
      return;
    }

    const { ReminderModule } = NativeModules;
    if (!ReminderModule) {
      return;
    }

    const hasPermission = await ReminderModule.hasExactAlarmPermission();
    if (hasPermission) {
      return;
    }

    Alert.alert(
      'Enable Offline Reminders',
      'To verify reliability, we need permission to set exact alarms. If you cancel, offline notifications may not work reliably app is killed.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: async () => {
            await AsyncStorage.setItem(STORAGE_KEY, 'true');
          },
        },
        {
          text: 'Enable',
          onPress: async () => {
            await AsyncStorage.setItem(STORAGE_KEY, 'true');
            ReminderModule.openExactAlarmSettings();
          },
        },
      ],
    );
  } catch (error) {
    console.warn('[Permissions] Startup check failed:', error);
  }
};
