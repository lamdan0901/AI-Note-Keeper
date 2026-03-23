import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  SafeAreaView,
  StyleSheet,
  View,
  ActivityIndicator,
  Alert,
  type FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getDb } from '../db/bootstrap';
import { getNoteById, Note, upsertNote } from '../db/notesRepo';
import { saveNoteOffline } from '../notes/editor';
import { markNoteSynced } from '../db/syncHelpers';
import { syncNotes } from '../sync/noteSync';
import { fetchNotes } from '../sync/fetchNotes';
import { SyncProvider, useSyncState } from '../sync/syncManager';
import { NotesList } from '../components/NotesList';
import { NotesHeader } from '../components/NotesHeader';
import { BOTTOM_ACTION_BAR_HEIGHT, SelectionActionBar } from '../components/SelectionActionBar';
import { NoteEditorModal, NoteEditorModalRef } from '../components/NoteEditorModal';
import { ConflictResolutionModal } from '../components/ConflictResolutionModal';
import { Toast } from '../components/Toast';
import { type Theme, useTheme } from '../theme';
import { RescheduleModal } from '../reminders/ui/SnoozeModal';
import { useNoteActions } from '../hooks/useNoteActions';
import { useNoteSelection } from '../hooks/useNoteSelection';
import { useToast } from '../hooks/useToast';
import { useHasDueSubscriptions } from '../subscriptions/useHasDueSubscriptions';
import { useRealtimeNotes } from '../notes/realtimeService';
import { isMobileNotesRealtimeV1Enabled } from '../constants/featureFlags';
import { RepeatRule } from '../../../../packages/shared/types/reminder';
import { NoteContentType } from '../../../../packages/shared/types/note';
import { useDebouncedValue } from '../../../../packages/shared/hooks/useDebouncedValue';

const DEFAULT_USER_ID = 'local-user';

function resolveUserId(): string {
  const envUser = process.env.EXPO_PUBLIC_USER_ID;
  return envUser || DEFAULT_USER_ID;
}

type NotesScreenProps = {
  rescheduleNoteId?: string | null;
  onRescheduleHandled?: () => void;
  editNoteId?: string | null;
  onEditHandled?: () => void;
  onNavigateToTrash?: () => void;
  onNavigateToSubscriptions?: () => void;
  subscriptionsEnabled?: boolean;
  viewMode: 'list' | 'grid';
  onViewModeChange: (mode: 'list' | 'grid') => void;
  onDueSubscriptionsChange?: (value: boolean) => void;
};

const DueSubscriptionsBridge = ({ onValue }: { onValue: (value: boolean) => void }) => {
  const hasDueSubscriptions = useHasDueSubscriptions();

  useEffect(() => {
    onValue(hasDueSubscriptions);
  }, [hasDueSubscriptions, onValue]);

  return null;
};

const RealtimeNotesBridge = ({ onValue }: { onValue: (notes: Note[] | undefined) => void }) => {
  const notes = useRealtimeNotes(true);

  useEffect(() => {
    onValue(notes);
  }, [notes, onValue]);

  return null;
};

const sortNotesForDisplay = (input: Note[]): Note[] => {
  return [...input].sort((a, b) => {
    const pinnedSort = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
    if (pinnedSort !== 0) return pinnedSort;

    const doneSort = Number(Boolean(a.done)) - Number(Boolean(b.done));
    if (doneSort !== 0) return doneSort;

    return b.updatedAt - a.updatedAt;
  });
};

const areNoteCollectionsEqual = (a: Note[], b: Note[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left.id !== right.id) return false;
    if (left.updatedAt !== right.updatedAt) return false;
    if (left.syncStatus !== right.syncStatus) return false;
    if (left.done !== right.done) return false;
    if (left.active !== right.active) return false;
    if (left.isPinned !== right.isPinned) return false;
  }
  return true;
};

const mergeRealtimeWithLocal = (localNotes: Note[], realtimeNotes: Note[]): Note[] => {
  const localById = new Map(localNotes.map((note) => [note.id, note]));
  const merged: Note[] = realtimeNotes.map((serverNote) => {
    const localNote = localById.get(serverNote.id);
    if (!localNote) return serverNote;

    const localPending = localNote.syncStatus === 'pending' || localNote.syncStatus === 'conflict';
    if (localPending) return localNote;

    if (localNote.updatedAt > serverNote.updatedAt) return localNote;

    return {
      ...serverNote,
      syncStatus: localNote.syncStatus ?? 'synced',
      // For non-pending notes, always track latest server version from realtime stream.
      serverVersion: serverNote.version ?? localNote.serverVersion ?? 0,
    };
  });

  for (const localNote of localNotes) {
    if (realtimeNotes.some((note) => note.id === localNote.id)) continue;
    const keepLocal =
      localNote.syncStatus === 'pending' ||
      localNote.syncStatus === 'conflict' ||
      (localNote.serverVersion ?? 0) === 0;
    if (keepLocal && localNote.active) {
      merged.push(localNote);
    }
  }

  return sortNotesForDisplay(merged);
};

const NotesScreenContent = ({
  rescheduleNoteId,
  onRescheduleHandled,
  editNoteId,
  onEditHandled,
  onNavigateToTrash,
  onNavigateToSubscriptions,
  subscriptionsEnabled = false,
  viewMode,
  onViewModeChange,
  onDueSubscriptionsChange,
}: NotesScreenProps) => {
  const { theme } = useTheme();
  const realtimeReadEnabled = subscriptionsEnabled && isMobileNotesRealtimeV1Enabled();
  const [realtimeNotes, setRealtimeNotes] = useState<Note[] | undefined>(undefined);
  const handleRealtimeNotesChange = useCallback((incoming: Note[] | undefined) => {
    setRealtimeNotes((prev) => {
      if (prev === undefined && incoming === undefined) return prev;
      if (prev && incoming && areNoteCollectionsEqual(prev, incoming)) return prev;
      return incoming;
    });
  }, []);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 250);
  const [rescheduleTargetId, setRescheduleTargetId] = useState<string | null>(null);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [conflictModalVisible, setConflictModalVisible] = useState(false);
  const [conflictLocalNote, setConflictLocalNote] = useState<Note | null>(null);
  const [conflictServerNote, setConflictServerNote] = useState<Note | null>(null);
  const [conflictLoading, setConflictLoading] = useState(false);
  const scrollTopVisibleRef = useRef(false);
  const editorModalRef = useRef<NoteEditorModalRef>(null);
  const listRef = useRef<FlatList<Note> | null>(null);

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

  useEffect(() => {
    if (!realtimeReadEnabled) {
      setRealtimeNotes(undefined);
      return;
    }
    if (realtimeNotes === undefined) return;
    setNotes((prev) => {
      const merged = mergeRealtimeWithLocal(prev, realtimeNotes);
      return areNoteCollectionsEqual(prev, merged) ? prev : merged;
    });
  }, [realtimeNotes, realtimeReadEnabled, setNotes]);

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
      contentType: NoteContentType;
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

  const handleOpenConflictModal = useCallback(
    async (note: Note) => {
      if (note.syncStatus !== 'conflict') return;

      setConflictLocalNote(note);
      setConflictServerNote(null);
      setConflictModalVisible(true);
      setConflictLoading(true);

      try {
        const realtimeMatch = realtimeNotes?.find((candidate) => candidate.id === note.id) ?? null;
        if (realtimeMatch) {
          setConflictServerNote(realtimeMatch);
          return;
        }

        const fetched = await fetchNotes(resolveUserId());
        if (fetched.status === 'ok') {
          const match = fetched.notes.find((candidate) => candidate.id === note.id) ?? null;
          setConflictServerNote(match);
        }
      } catch (e) {
        console.error(e);
        showToast('Failed to load server version', true);
      } finally {
        setConflictLoading(false);
      }
    },
    [realtimeNotes, showToast],
  );

  const closeConflictModal = useCallback(
    (force: boolean = false) => {
      if (conflictLoading && !force) return;
      setConflictModalVisible(false);
      setConflictLocalNote(null);
      setConflictServerNote(null);
    },
    [conflictLoading],
  );

  const handleKeepLocalConflict = useCallback(async () => {
    if (!conflictLocalNote) return;

    notifyActionPending();
    setConflictLoading(true);

    try {
      const db = await getDb();
      const baseVersion =
        conflictServerNote?.version ??
        conflictLocalNote.serverVersion ??
        conflictLocalNote.version ??
        0;
      const pendingLocal: Note = {
        ...conflictLocalNote,
        syncStatus: 'pending',
        serverVersion: baseVersion,
        version: baseVersion,
        updatedAt: Date.now(),
      };

      await saveNoteOffline(db, pendingLocal, 'update');
      await syncNotes(db);
      setNotes((prev) =>
        prev.map((note) =>
          note.id === conflictLocalNote.id ? { ...note, syncStatus: 'synced' } : note,
        ),
      );
      await loadNotes();
      notifyActionSuccess();
      setConflictLoading(false);
      closeConflictModal(true);
      editorModalRef.current?.closeEditor();
    } catch (e) {
      console.error(e);
      notifyActionError('Failed to resolve conflict');
      loadNotes();
    } finally {
      setConflictLoading(false);
    }
  }, [
    closeConflictModal,
    conflictLocalNote,
    conflictServerNote,
    loadNotes,
    notifyActionError,
    notifyActionPending,
    notifyActionSuccess,
    setNotes,
  ]);

  const handleUseServerConflict = useCallback(async () => {
    if (!conflictLocalNote) return;

    notifyActionPending();
    setConflictLoading(true);

    try {
      const db = await getDb();

      if (conflictServerNote) {
        const serverVersion = conflictServerNote.version ?? conflictServerNote.serverVersion ?? 0;
        await upsertNote(db, {
          ...conflictServerNote,
          syncStatus: 'synced',
          serverVersion,
        });
        await markNoteSynced(db, conflictLocalNote.id, serverVersion);
      } else {
        await upsertNote(db, {
          ...conflictLocalNote,
          active: false,
          deletedAt: Date.now(),
          syncStatus: 'synced',
          updatedAt: Date.now(),
        });
      }

      await db.runAsync('DELETE FROM note_outbox WHERE noteId = ?', [conflictLocalNote.id]);
      setNotes((prev) => prev.filter((note) => note.id !== conflictLocalNote.id || note.active));
      await loadNotes();
      notifyActionSuccess();
      setConflictLoading(false);
      closeConflictModal(true);
      editorModalRef.current?.closeEditor();
    } catch (e) {
      console.error(e);
      notifyActionError('Failed to apply server version');
      loadNotes();
    } finally {
      setConflictLoading(false);
    }
  }, [
    closeConflictModal,
    conflictLocalNote,
    conflictServerNote,
    loadNotes,
    notifyActionError,
    notifyActionPending,
    notifyActionSuccess,
    setNotes,
  ]);

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

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    const shouldShow = offsetY > 200;
    if (scrollTopVisibleRef.current === shouldShow) return;
    scrollTopVisibleRef.current = shouldShow;
    setShowScrollTop(shouldShow);
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
  const isRealtimeHydrating =
    realtimeReadEnabled && realtimeNotes === undefined && notes.length === 0;
  const filteredNotes = useMemo(() => {
    const normalizedQuery = debouncedSearchQuery.trim().toLowerCase();
    if (!normalizedQuery) return notes;
    return notes.filter((note) => {
      const title = (note.title ?? '').toLowerCase();
      const content = (note.content ?? '').toLowerCase();
      return title.includes(normalizedQuery) || content.includes(normalizedQuery);
    });
  }, [debouncedSearchQuery, notes]);

  return (
    <SafeAreaView style={styles.container}>
      {subscriptionsEnabled && onDueSubscriptionsChange && (
        <DueSubscriptionsBridge onValue={onDueSubscriptionsChange} />
      )}
      {realtimeReadEnabled && <RealtimeNotesBridge onValue={handleRealtimeNotesChange} />}

      <NotesHeader
        viewMode={viewMode}
        selectionMode={selectionMode}
        onViewModeToggle={() => onViewModeChange(viewMode === 'grid' ? 'list' : 'grid')}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
      />

      <SelectionActionBar
        selectionHeaderAnim={selectionHeaderAnim}
        selectedCount={selectedNoteIds.size}
        onCancel={clearSelection}
        onMarkDone={handleBulkMarkDone}
        onSnooze={handleBulkSnoozeSelected}
        onDelete={handleBulkDeleteSelected}
      />

      {/* Content */}
      {loading || isRealtimeHydrating ? (
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
            notes={filteredNotes}
            viewMode={viewMode}
            onNotePress={(id) => {
              const note = filteredNotes.find((n) => n.id === id);
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
            searchQuery={debouncedSearchQuery}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            listRef={listRef}
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
          <Ionicons name="add" size={26} color="white" />
        </Pressable>
      </Animated.View>

      {showScrollTop && (
        <Animated.View
          style={[
            styles.scrollTopContainer,
            {
              transform: [
                {
                  translateY: selectionHeaderAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -BOTTOM_ACTION_BAR_HEIGHT + 16],
                  }),
                },
              ],
            },
          ]}
        >
          <Pressable
            style={styles.scrollTopButton}
            onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
          >
            <Ionicons name="arrow-up" size={20} color="white" />
          </Pressable>
        </Animated.View>
      )}

      <NoteEditorModal
        ref={editorModalRef}
        onSave={saveNote}
        onDelete={handleDelete}
        onResolveConflictPress={handleOpenConflictModal}
      />

      <ConflictResolutionModal
        visible={conflictModalVisible}
        localNote={conflictLocalNote}
        serverNote={conflictServerNote}
        loading={conflictLoading}
        onClose={closeConflictModal}
        onKeepLocal={handleKeepLocalConflict}
        onUseServer={handleUseServerConflict}
      />

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
      bottom: 100,
      right: theme.spacing.xl,
      zIndex: 900,
    },
    fab: {
      backgroundColor: theme.colors.primary,
      width: 46,
      height: 46,
      borderRadius: 23,
      justifyContent: 'center',
      alignItems: 'center',
      ...theme.shadows.md,
    },
    scrollTopContainer: {
      position: 'absolute',
      bottom: 100,
      left: theme.spacing.xl,
      zIndex: 900,
    },
    scrollTopButton: {
      backgroundColor: theme.colors.primary,
      width: 46,
      height: 46,
      borderRadius: 23,
      justifyContent: 'center',
      alignItems: 'center',
      ...theme.shadows.md,
    },
  });
