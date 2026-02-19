import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  SafeAreaView,
  StyleSheet,
  View,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getDb } from '../db/bootstrap';
import { getNoteById, Note } from '../db/notesRepo';
import { saveNoteOffline } from '../notes/editor';
import { syncNotes } from '../sync/noteSync';
import { SyncProvider, useSyncState } from '../sync/syncManager';
import { NotesList } from '../components/NotesList';
import { NotesHeader } from '../components/NotesHeader';
import { SettingsDrawer } from '../components/SettingsDrawer';
import { BOTTOM_ACTION_BAR_HEIGHT, SelectionActionBar } from '../components/SelectionActionBar';
import { NoteEditorModal, NoteEditorModalRef } from '../components/NoteEditorModal';
import { Toast } from '../components/Toast';
import { type Theme, useTheme } from '../theme';
import { RescheduleModal } from '../reminders/ui/SnoozeModal';
import { useNoteActions } from '../hooks/useNoteActions';
import { useNoteSelection } from '../hooks/useNoteSelection';
import { useToast } from '../hooks/useToast';
import { RepeatRule } from '../../../../packages/shared/types/reminder';

type NotesScreenProps = {
  rescheduleNoteId?: string | null;
  onRescheduleHandled?: () => void;
  editNoteId?: string | null;
  onEditHandled?: () => void;
};

const NotesScreenContent = ({
  rescheduleNoteId,
  onRescheduleHandled,
  editNoteId,
  onEditHandled,
}: NotesScreenProps) => {
  const { theme } = useTheme();
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid'); // Default to Bento/Grid
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [rescheduleTargetId, setRescheduleTargetId] = useState<string | null>(null);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const drawerAnim = useRef(new Animated.Value(0)).current;
  const editorModalRef = useRef<NoteEditorModalRef>(null);

  const openDrawer = useCallback(() => {
    setDrawerVisible(true);
    Animated.timing(drawerAnim, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [drawerAnim]);

  const closeDrawer = useCallback(() => {
    Animated.timing(drawerAnim, {
      toValue: 0,
      duration: 220,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setDrawerVisible(false);
    });
  }, [drawerAnim]);

  // Get sync state and action helpers
  const { notifyActionPending, notifyActionSuccess, notifyActionError, lastSyncAt } =
    useSyncState();

  const { toast, showToast } = useToast();

  const {
    notes,
    setNotes,
    loading,
    refreshing,
    loadNotes,
    handleRefresh,
    saveNote: saveNoteAction,
    performDelete,
    handleNoteDone,
  } = useNoteActions({
    notifyActionPending,
    notifyActionSuccess,
    notifyActionError,
    lastSyncAt,
    showToast,
    closeEditor: () => editorModalRef.current?.closeEditor(),
  });

  const {
    selectedNoteIds,
    selectionMode,
    selectionHeaderAnim,
    clearSelection,
    handleNoteLongPress,
  } = useNoteSelection(notes);

  const saveNote = useCallback(
    (editorState: {
      editingNote: Note | null;
      title: string;
      content: string;
      reminder: Date | null;
      repeat: RepeatRule | null;
      isPinned: boolean;
      color: string | null;
    }) => {
      saveNoteAction(editorState);
    },
    [saveNoteAction],
  );

  useEffect(() => {
    if (!rescheduleNoteId) return;
    let cancelled = false;
    const openRescheduleFlow = async () => {
      try {
        const db = await getDb();
        const note = await getNoteById(db, rescheduleNoteId);
        if (cancelled) return;
        if (!note) {
          Alert.alert('Note not found', 'Unable to open the note for reschedule.');
          return;
        }
        setRescheduleTargetId(note.id);
        setShowRescheduleModal(true);
      } finally {
        onRescheduleHandled?.();
      }
    };
    void openRescheduleFlow();
    return () => {
      cancelled = true;
    };
  }, [rescheduleNoteId, onRescheduleHandled]);

  useEffect(() => {
    if (!editNoteId) return;

    let cancelled = false;

    const openEditFlow = async () => {
      try {
        const db = await getDb();
        const note = await getNoteById(db, editNoteId);
        if (cancelled) return;
        if (!note) {
          Alert.alert('Note not found', 'Unable to open the note.');
          return;
        }

        editorModalRef.current?.openEditor(note);
      } finally {
        onEditHandled?.();
      }
    };

    openEditFlow();

    return () => {
      cancelled = true;
    };
  }, [editNoteId, onEditHandled]);

  const handleSelectionAwareDelete = useCallback(
    (ids: string[]) => {
      if (selectionMode && ids.some((id) => selectedNoteIds.has(id))) clearSelection();
      performDelete(ids);
    },
    [clearSelection, performDelete, selectedNoteIds, selectionMode],
  );

  const handleDelete = useCallback(() => {
    const editingNote = editorModalRef.current?.getEditorState()?.editingNote;
    if (!editingNote) return;
    editorModalRef.current?.closeEditor();
    handleSelectionAwareDelete([editingNote.id]);
  }, [handleSelectionAwareDelete]);

  const handleNoteReschedule = useCallback((noteId: string) => {
    setRescheduleTargetId(noteId);
    setShowRescheduleModal(true);
  }, []);

  const handleNoteDelete = useCallback(
    (noteId: string) => {
      handleSelectionAwareDelete([noteId]);
    },
    [handleSelectionAwareDelete],
  );

  const handleBulkDeleteSelected = useCallback(() => {
    handleSelectionAwareDelete(Array.from(selectedNoteIds));
  }, [handleSelectionAwareDelete, selectedNoteIds]);

  const handleBulkSnoozeSelected = useCallback(() => {
    const [id] = Array.from(selectedNoteIds);
    if (!id) return;
    handleNoteReschedule(id);
  }, [handleNoteReschedule, selectedNoteIds]);

  const handleBulkMarkDone = useCallback(async () => {
    const ids = Array.from(selectedNoteIds);
    const toUpdate = notes.filter((n) => ids.includes(n.id));
    if (toUpdate.length === 0) return;

    // Optimistic Update
    const now = Date.now();
    const updatedNotes: Note[] = [];

    setNotes((prev) =>
      prev.map((note) => {
        if (!ids.includes(note.id)) return note;

        // Toggle done state
        const updated: Note = note.done
          ? { ...note, done: false, updatedAt: now }
          : {
              ...note,
              active: true,
              done: true,
              triggerAt: undefined,
              repeatRule: undefined,
              repeatConfig: undefined,
              repeat: undefined,
              snoozedUntil: undefined,
              scheduleStatus: undefined,
              timezone: undefined,
              baseAtLocal: undefined,
              startAt: undefined,
              nextTriggerAt: undefined,
              lastFiredAt: undefined,
              lastAcknowledgedAt: undefined,
              updatedAt: now,
            };

        updatedNotes.push(updated);
        return updated;
      }),
    );

    clearSelection();
    const allDone = toUpdate.every((n) => n.done);
    showToast(allDone ? 'Marked undone' : 'Marked done', false);

    notifyActionPending();

    try {
      const db = await getDb();
      await Promise.all(updatedNotes.map((note) => saveNoteOffline(db, note, 'update')));
      await syncNotes(db);
      notifyActionSuccess();
    } catch (e) {
      console.error(e);
      notifyActionError('Failed to update done');
      loadNotes();
    }
  }, [
    clearSelection,
    loadNotes,
    notes,
    notifyActionError,
    notifyActionPending,
    notifyActionSuccess,
    selectedNoteIds,
    setNotes,
    showToast,
  ]);

  const closeReschedule = useCallback(() => {
    setShowRescheduleModal(false);
    setRescheduleTargetId(null);
  }, []);

  const handleRescheduled = async (noteId: string, snoozedUntil: number) => {
    const now = Date.now();

    // 1. Optimistic Update (Immediate UI Refresh)
    setNotes((prev) =>
      prev.map((note) =>
        note.id === noteId
          ? {
              ...note,
              done: false,
              snoozedUntil,
              triggerAt: snoozedUntil,
              nextTriggerAt: snoozedUntil,
              scheduleStatus: 'scheduled',
              active: true,
              updatedAt: now,
            }
          : note,
      ),
    );

    const editorState = editorModalRef.current?.getEditorState();
    if (editorState?.editingNote?.id === noteId) {
      const updatedNote = {
        ...editorState.editingNote,
        done: false,
        snoozedUntil,
        triggerAt: snoozedUntil,
        nextTriggerAt: snoozedUntil,
        scheduleStatus: 'scheduled' as const,
        active: true,
        updatedAt: now,
      };
      editorModalRef.current?.setEditingNote(updatedNote);
      editorModalRef.current?.setReminder(new Date(snoozedUntil));
    }

    showToast('Rescheduled successfully', false);

    // 2. Background Persistence & Sync
    notifyActionPending();

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
          updatedAt: now,
        };

        await saveNoteOffline(db, updatedNote, 'update');
        await syncNotes(db);
        notifyActionSuccess();

        loadNotes();
      }
    } catch (e) {
      console.error(e);
      notifyActionError('Failed to reschedule');
      loadNotes();
    }
  };

  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <SafeAreaView style={styles.container}>
      <NotesHeader
        viewMode={viewMode}
        selectionMode={selectionMode}
        onMenuPress={openDrawer}
        onViewModeToggle={() => setViewMode((prev) => (prev === 'grid' ? 'list' : 'grid'))}
      />

      <SettingsDrawer visible={drawerVisible} onClose={closeDrawer} drawerAnim={drawerAnim} />

      <SelectionActionBar
        selectionHeaderAnim={selectionHeaderAnim}
        selectedCount={selectedNoteIds.size}
        onCancel={clearSelection}
        onMarkDone={handleBulkMarkDone}
        onSnooze={handleBulkSnoozeSelected}
        onDelete={handleBulkDeleteSelected}
      />

      {/* Content */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <Pressable
          style={styles.contentPressable}
          onPress={clearSelection}
          disabled={!selectionMode}
        >
          <NotesList
            notes={notes}
            viewMode={viewMode}
            onNotePress={(id) => {
              const note = notes.find((n) => n.id === id);
              editorModalRef.current?.openEditor(note);
            }}
            onNoteLongPress={handleNoteLongPress}
            selectionMode={selectionMode}
            selectedNoteIds={selectedNoteIds}
            onNoteDone={handleNoteDone}
            onNoteReschedule={handleNoteReschedule}
            onNoteDelete={handleNoteDelete}
            onRefresh={handleRefresh}
            refreshing={refreshing}
          />
        </Pressable>
      )}

      {/* FAB */}
      <Animated.View
        style={[
          styles.fabContainer,
          {
            transform: [
              {
                translateY: selectionHeaderAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, -BOTTOM_ACTION_BAR_HEIGHT + 16], // Move up
                }),
              },
            ],
          },
        ]}
      >
        <Pressable style={styles.fab} onPress={() => editorModalRef.current?.openEditor()}>
          <Ionicons name="add" size={32} color="white" />
        </Pressable>
      </Animated.View>

      <NoteEditorModal ref={editorModalRef} onSave={saveNote} onDelete={handleDelete} />

      {rescheduleTargetId && (
        <RescheduleModal
          visible={showRescheduleModal}
          noteId={rescheduleTargetId}
          onClose={closeReschedule}
          onSaveStart={closeReschedule}
          onRescheduled={handleRescheduled}
          onError={() => {
            showToast('Failed to reschedule', true);
          }}
        />
      )}

      <Toast visible={toast.show} message={toast.message} isError={toast.isError} />
    </SafeAreaView>
  );
};

export const NotesScreen = (props: NotesScreenProps) => {
  return (
    <SyncProvider>
      <NotesScreenContent {...props} />
    </SyncProvider>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    contentPressable: {
      flex: 1,
    },
    fabContainer: {
      position: 'absolute',
      bottom: theme.spacing.xl,
      right: theme.spacing.xl,
      zIndex: 900,
    },
    fab: {
      backgroundColor: theme.colors.primary,
      width: 56,
      height: 56,
      borderRadius: 28,
      justifyContent: 'center',
      alignItems: 'center',
      ...theme.shadows.md,
    },
  });
