import React, { useEffect, useState } from 'react';
import { StyleSheet, View, StatusBar } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getMessaging, onMessage, onTokenRefresh } from '@react-native-firebase/messaging';
import { ConvexProvider, ConvexReactClient } from 'convex/react';

import * as SplashScreen from 'expo-splash-screen';

import { runMigrations } from './src/db/bootstrap';
import { configureReminderNotifications } from './src/reminders/notifications';
import { registerDevicePushToken } from './src/sync/registerDeviceToken';
import { handleFcmMessage, handleNotificationResponse } from './src/sync/fcmMessageHandler';
import { checkStartupPermissions } from './src/reminders/permissions';
import { NotesScreen } from './src/screens/NotesScreen';
import { ThemeProvider, useTheme } from './src/theme';

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

import { Linking } from 'react-native';
import { rescheduleAllActiveReminders } from './src/reminders/scheduler';
import { getDb } from './src/db/bootstrap';
import NetInfo from '@react-native-community/netinfo';

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null;

export default function App(): JSX.Element | null {
  const [isReady, setIsReady] = useState(false);
  const [rescheduleNoteId, setRescheduleNoteId] = useState<string | null>(null);
  const [editNoteId, setEditNoteId] = useState<string | null>(null);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        await runMigrations();
        await configureReminderNotifications();

        const permissions = await Notifications.getPermissionsAsync();
        if (!permissions.granted) {
          await Notifications.requestPermissionsAsync();
        }
        await checkStartupPermissions();
        await registerDevicePushToken();

        // Only schedule local alarms when the device is offline.
        // When online, the server cron + FCM push path handles delivery.
        const netState = await NetInfo.fetch();
        const isOnline = netState.isConnected === true && netState.isInternetReachable === true;
        if (!isOnline) {
          const db = await getDb();
          await rescheduleAllActiveReminders(db);
        }

        // Check for initial launch props from MainActivity
        // @ts-expect-error - RN internal API
        const initialProps = global.__INITIAL_PROPS__;
        if (initialProps?.editNoteId) {
          console.log('[Deep Link] Found editNoteId in launch props:', initialProps.editNoteId);
          setEditNoteId(initialProps.editNoteId);
        }
      } catch (e) {
        console.error('Bootstrap error:', e);
      } finally {
        setIsReady(true);
        await SplashScreen.hideAsync();
      }
    };
    void bootstrap();

    // Deep Linking for Reschedule and Edit Actions
    const handleUrl = (event: { url: string }) => {
      try {
        const url = event.url;
        console.log('[Deep Link] Received URL:', url);
        if (url.includes('reschedule') && url.includes('noteId=')) {
          // Simple parsing for ainotekeeper://reschedule?noteId=XYZ
          const match = url.match(/noteId=([^&]+)/);
          if (match && match[1]) {
            console.log('[Deep Link] Setting reschedule note ID:', match[1]);
            setRescheduleNoteId(match[1]);
          }
        } else if (url.includes('edit') && url.includes('noteId=')) {
          // Simple parsing for ainotekeeper://edit?noteId=XYZ
          const match = url.match(/noteId=([^&]+)/);
          if (match && match[1]) {
            console.log('[Deep Link] Setting edit note ID:', match[1]);
            setEditNoteId(match[1]);
          }
        }
      } catch (e) {
        console.error('Deep link error:', e);
      }
    };

    Linking.getInitialURL()
      .then((url) => {
        console.log('[Deep Link] Initial URL:', url);
        if (url) handleUrl({ url });
      })
      .catch((err) => {
        console.error('[Deep Link] Error getting initial URL:', err);
      });
    const linkSub = Linking.addEventListener('url', handleUrl);

    // Handle foreground FCM messages
    const messaging = getMessaging();
    const unsubscribeFcm = onMessage(messaging, async (remoteMessage) => {
      await handleFcmMessage(remoteMessage);
    });

    // Re-register device token whenever FCM rotates it
    const unsubscribeTokenRefresh = onTokenRefresh(messaging, async () => {
      try {
        await registerDevicePushToken();
      } catch (e) {
        console.error('[TokenRefresh] Failed to re-register token:', e);
      }
    });

    // Handle notification tap/interaction
    const notificationSubscription = Notifications.addNotificationResponseReceivedListener(
      handleNotificationResponse,
    );

    return () => {
      unsubscribeFcm();
      unsubscribeTokenRefresh();
      notificationSubscription.remove();
      linkSub.remove();
    };
  }, []);

  if (!isReady) {
    return null;
  }

  const effectiveRescheduleNoteId = convexClient ? rescheduleNoteId : null;
  const effectiveEditNoteId = editNoteId;
  const content = (
    <AppContent
      rescheduleNoteId={effectiveRescheduleNoteId ?? undefined}
      onRescheduleHandled={() => setRescheduleNoteId(null)}
      editNoteId={effectiveEditNoteId ?? undefined}
      onEditHandled={() => setEditNoteId(null)}
    />
  );

  if (!convexClient) {
    return <ThemeProvider>{content}</ThemeProvider>;
  }

  return (
    <ThemeProvider>
      <ConvexProvider client={convexClient}>{content}</ConvexProvider>
    </ThemeProvider>
  );
}

const AppContent = ({
  rescheduleNoteId,
  onRescheduleHandled,
  editNoteId,
  onEditHandled,
}: {
  rescheduleNoteId?: string;
  onRescheduleHandled: () => void;
  editNoteId?: string;
  onEditHandled: () => void;
}) => {
  const { theme, resolvedMode } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <StatusBar
        barStyle={resolvedMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.colors.background}
        translucent={false}
      />
      <NotesScreen
        rescheduleNoteId={rescheduleNoteId}
        onRescheduleHandled={onRescheduleHandled}
        editNoteId={editNoteId}
        onEditHandled={onEditHandled}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
