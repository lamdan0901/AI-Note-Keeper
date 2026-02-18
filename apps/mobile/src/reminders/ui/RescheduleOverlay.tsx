import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, BackHandler, Text, StyleSheet } from 'react-native';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import { RescheduleModal } from './SnoozeModal';
import { getDb, runMigrations } from '../../db/bootstrap';
import { type Theme, useTheme } from '../../theme';
import { saveNoteOffline } from '../../notes/editor';
import { getNoteById, Note } from '../../db/notesRepo';
import { syncNotes } from '../../sync/noteSync';

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : undefined;

export const RescheduleOverlay = (props: { noteId?: string }) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [ready, setReady] = useState(false);
  const [modalVisible, setModalVisible] = useState(true);
  const [toast, setToast] = useState<{ show: boolean; message: string; isError: boolean }>({
    show: false,
    message: '',
    isError: false,
  });

  // Refs to track completion state for exit logic
  const workDone = useRef(false);
  const minTimePassed = useRef(false);

  useEffect(() => {
    const init = async () => {
      try {
        await runMigrations(); // Ensure migrations
        await getDb(); // Ensure DB connection
        setReady(true);
      } catch (e) {
        console.error('RescheduleOverlay init failed', e);
        BackHandler.exitApp();
      }
    };
    init();
  }, []);

  const checkExit = () => {
    if (workDone.current && minTimePassed.current) {
      BackHandler.exitApp();
    }
  };

  const handleClose = () => {
    // If we are showing a toast (saving/saved), don't exit via this handler
    // The exit will be handled by checkExit()
    if (!toast.show) {
      BackHandler.exitApp();
    }
  };

  const startToast = (message: string, isError: boolean) => {
    setToast({ show: true, message, isError });
    minTimePassed.current = false;
    setTimeout(() => {
      minTimePassed.current = true;
      checkExit();
    }, 1000);
  };

  const handleSaveStart = () => {
    setModalVisible(false);
  };

  const handleSuccess = (noteId: string, snoozedUntil: number) => {
    // 1. Immediately show success toast (Optimistic UI)
    startToast('Rescheduled successfully', false);

    // 2. Perform persistence in background
    workDone.current = true; // Mark as done for exit logic (but we wait a bit for sync if possible?)
    // Actually, for headless tasks, we might want to wait for sync or just enqueue.
    // enqueue is fast.

    void (async () => {
      try {
        const db = await getDb();
        const note = await getNoteById(db, noteId);

        if (note) {
          const updatedNote: Note = {
            ...note,
            done: false,
            snoozedUntil,
            triggerAt: snoozedUntil,
            nextTriggerAt: snoozedUntil,
            scheduleStatus: 'scheduled',
            active: true,
            updatedAt: Date.now(),
          };

          await saveNoteOffline(db, updatedNote, 'update');
          // Try to sync, but don't block exit too long if it fails?
          // Since it's in outbox, it's safe.
          syncNotes(db).catch((err) => console.error('Background sync failed', err));
        }
      } catch (e) {
        console.error('Failed to save reschedule', e);
        startToast('Failed to save', true);
      } finally {
        checkExit();
      }
    })();
  };

  const handleError = (e: unknown) => {
    console.error('Reschedule error in overlay', e);
    startToast('Failed to reschedule', true);
    workDone.current = true;
    checkExit();
  };

  if (!props.noteId) {
    handleClose();
    return null;
  }

  if (!convexClient) {
    return (
      <View style={styles.centered}>
        <Text style={styles.messageText}>Missing Configuration</Text>
      </View>
    );
  }

  if (!ready) {
    return <View style={styles.transparentFill} />;
  }

  return (
    <ConvexProvider client={convexClient}>
      <View style={styles.transparentFill}>
        <RescheduleModal
          visible={modalVisible}
          noteId={props.noteId}
          onClose={handleClose}
          transparentOverlay
          onSaveStart={handleSaveStart}
          onRescheduled={handleSuccess}
          onError={handleError}
        />

        {toast.show && (
          <View style={styles.toastContainer} pointerEvents="none">
            <View style={[styles.toast, toast.isError && styles.toastError]}>
              <Text style={styles.toastText}>{toast.message}</Text>
            </View>
          </View>
        )}
      </View>
    </ConvexProvider>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    transparentFill: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    messageText: {
      color: theme.colors.text,
    },
    toastContainer: {
      position: 'absolute',
      bottom: 50,
      left: 0,
      right: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    toast: {
      backgroundColor: '#333333',
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 24,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 3.84,
      elevation: 5,
    },
    toastError: {
      backgroundColor: theme.colors.error,
    },
    toastText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '500',
    },
  });
