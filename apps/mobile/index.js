import 'react-native-get-random-values';
import { registerRootComponent } from 'expo';
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import App from './App';
import { handleFcmMessage } from './src/sync/fcmMessageHandler';
import { registerFcmHeadlessTask } from './src/sync/fcmHeadlessTask';

// Register FCM background message handler (app killed/background)
// This MUST be called before registerRootComponent
const messaging = getMessaging();
setBackgroundMessageHandler(messaging, async (remoteMessage) => {
  await handleFcmMessage(remoteMessage);
});

// Register headless task for data-only messages
registerFcmHeadlessTask();

// Register headless tasks for Reminders (Done, Reschedule)
import { registerHeadlessTasks } from './src/reminders/headless';
registerHeadlessTasks();

import { AppRegistry } from 'react-native';
import { RescheduleOverlay } from './src/reminders/ui/RescheduleOverlay';

registerRootComponent(App);
AppRegistry.registerComponent('RescheduleOverlay', () => RescheduleOverlay);
