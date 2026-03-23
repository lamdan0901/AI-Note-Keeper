import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View, StatusBar } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getMessaging, onMessage, onTokenRefresh } from '@react-native-firebase/messaging';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import * as NavigationBar from 'expo-navigation-bar';

import * as SplashScreen from 'expo-splash-screen';

import { runMigrations } from './src/db/bootstrap';
import { configureReminderNotifications } from './src/reminders/notifications';
import { registerDevicePushToken } from './src/sync/registerDeviceToken';
import { handleFcmMessage, handleNotificationResponse } from './src/sync/fcmMessageHandler';
import { checkStartupPermissions } from './src/reminders/permissions';
import { NotesScreen } from './src/screens/NotesScreen';
import { TrashScreen } from './src/screens/TrashScreen';
import { SubscriptionsScreen } from './src/screens/SubscriptionsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { BottomTabBar } from './src/components/BottomTabBar';
import { ThemeProvider, useTheme } from './src/theme';

SplashScreen.preventAutoHideAsync();

import { Linking } from 'react-native';
import { rescheduleAllActiveReminders } from './src/reminders/scheduler';
import { getDb } from './src/db/bootstrap';

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null;
const hasConvexBackend = Boolean(convexUrl);

export default function App(): JSX.Element | null {
  const [isReady, setIsReady] = useState(false);
  const [rescheduleNoteId, setRescheduleNoteId] = useState<string | null>(null);
  const [editNoteId, setEditNoteId] = useState<string | null>(null);

  useEffect(() => {
    const runBackgroundInitialization = async () => {
      try {
        const permissions = await Notifications.getPermissionsAsync();
        if (!permissions.granted) {
          await Notifications.requestPermissionsAsync();
        }
        await checkStartupPermissions();
        if (hasConvexBackend) {
          await registerDevicePushToken();
        }

        const db = await getDb();
        await rescheduleAllActiveReminders(db);
      } catch (e) {
        console.error('Background initialization error:', e);
      }
    };

    const bootstrap = async () => {
      try {
        // Critical blocking tasks
        await runMigrations();
        await configureReminderNotifications();

        runBackgroundInitialization();

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
    const unsubscribeTokenRefresh = hasConvexBackend
      ? onTokenRefresh(messaging, async () => {
          try {
            await registerDevicePushToken();
          } catch (e) {
            console.error('[TokenRefresh] Failed to re-register token:', e);
          }
        })
      : () => {};

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
      hasConvexClient={Boolean(convexClient)}
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
  hasConvexClient,
}: {
  rescheduleNoteId?: string;
  onRescheduleHandled: () => void;
  editNoteId?: string;
  onEditHandled: () => void;
  hasConvexClient: boolean;
}) => {
  const { theme, resolvedMode } = useTheme();
  const [currentScreen, setCurrentScreen] = useState<
    'notes' | 'trash' | 'subscriptions' | 'settings'
  >('notes');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid');
  const [hasDueSubscriptions, setHasDueSubscriptions] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setBackgroundColorAsync(theme.colors.background);
      NavigationBar.setButtonStyleAsync(resolvedMode === 'dark' ? 'light' : 'dark');
    }
  }, [theme.colors.background, resolvedMode]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <StatusBar
        barStyle={resolvedMode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.colors.background}
        translucent={false}
      />
      <View style={styles.screenArea}>
        <View
          style={currentScreen === 'notes' ? styles.screenVisible : styles.screenHidden}
          pointerEvents={currentScreen === 'notes' ? 'auto' : 'none'}
        >
          <NotesScreen
            rescheduleNoteId={rescheduleNoteId}
            onRescheduleHandled={onRescheduleHandled}
            editNoteId={editNoteId}
            onEditHandled={onEditHandled}
            onNavigateToTrash={() => setCurrentScreen('trash')}
            onNavigateToSubscriptions={
              hasConvexClient ? () => setCurrentScreen('subscriptions') : undefined
            }
            subscriptionsEnabled={hasConvexClient}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onDueSubscriptionsChange={hasConvexClient ? setHasDueSubscriptions : undefined}
          />
        </View>

        <View
          style={currentScreen === 'trash' ? styles.screenVisible : styles.screenHidden}
          pointerEvents={currentScreen === 'trash' ? 'auto' : 'none'}
        >
          <TrashScreen
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onNavigateToNotes={() => setCurrentScreen('notes')}
            onNavigateToSubscriptions={
              hasConvexClient ? () => setCurrentScreen('subscriptions') : undefined
            }
            subscriptionsEnabled={hasConvexClient}
          />
        </View>

        {hasConvexClient && (
          <View
            style={currentScreen === 'subscriptions' ? styles.screenVisible : styles.screenHidden}
            pointerEvents={currentScreen === 'subscriptions' ? 'auto' : 'none'}
          >
            <SubscriptionsScreen />
          </View>
        )}

        <View
          style={currentScreen === 'settings' ? styles.screenVisible : styles.screenHidden}
          pointerEvents={currentScreen === 'settings' ? 'auto' : 'none'}
        >
          <SettingsScreen />
        </View>
      </View>

      <BottomTabBar
        activeTab={currentScreen}
        onTabPress={setCurrentScreen}
        hasConvexClient={hasConvexClient}
        showDueSubscriptionsIndicator={hasDueSubscriptions}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  screenArea: {
    flex: 1,
  },
  screenVisible: {
    flex: 1,
  },
  screenHidden: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
