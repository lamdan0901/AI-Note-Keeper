import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
  Alert,
  AppState,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getDb } from '../db/bootstrap';
import { getNoteById, listNotes, Note } from '../db/notesRepo';
import { saveNoteOffline, deleteNoteOffline } from '../notes/editor';
import { syncNotes } from '../sync/noteSync';
import { NotesList } from '../components/NotesList';
import { theme } from '../theme';
import uuid from 'react-native-uuid';
import { ReminderSetupModal } from '../reminders/ui/ReminderSetupModal';
import { RescheduleModal } from '../reminders/ui/SnoozeModal';
import { RepeatRule } from '../../../../packages/shared/types/reminder';

const SELECTION_HEADER_HEIGHT = 56;

type NotesScreenProps = {
  rescheduleNoteId?: string | null;
  onRescheduleHandled?: () => void;
  editNoteId?: string | null;
  onEditHandled?: () => void;
};

export const NotesScreen = ({
  rescheduleNoteId,
  onRescheduleHandled,
  editNoteId,
  onEditHandled,
}: NotesScreenProps) => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid'); // Default to Bento/Grid
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());

  // Editor State
  const [modalVisible, setModalVisible] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [reminder, setReminder] = useState<Date | null>(null);
  const [repeat, setRepeat] = useState<RepeatRule | null>(null);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [rescheduleTargetId, setRescheduleTargetId] = useState<string | null>(null);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [toast, setToast] = useState<{ show: boolean; message: string; isError: boolean }>({
    show: false,
    message: '',
    isError: false,
  });
  const [deleteConfirm, setDeleteConfirm] = useState<{ visible: boolean; noteIds: string[] }>({
    visible: false,
    noteIds: [],
  });
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionHeaderAnim = useRef(new Animated.Value(0)).current;
  const editorTranslateY = useRef(new Animated.Value(0)).current;
  const editorTouchStartRef = useRef<{ x: number; y: number; timeMs: number } | null>(null);
  const editorDraggingRef = useRef(false);
  const deleteConfirmCount = deleteConfirm.noteIds.length;
  const deleteConfirmTitle =
    deleteConfirmCount === 1 ? 'Delete note?' : `Delete ${deleteConfirmCount} notes?`;
  const deleteConfirmMessage =
    deleteConfirmCount === 1
      ? 'This will remove the note from your list.'
      : 'This will remove the selected notes from your list.';

  const selectionMode = selectedNoteIds.size > 0;

  const loadNotes = useCallback(async () => {
    try {
      const db = await getDb();
      const loadedNotes = await listNotes(db);
      setNotes(loadedNotes);
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Failed to load notes');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      // 1. Load local notes immediately for speed
      await loadNotes();

      // 2. Trigger sync in background
      try {
        const db = await getDb();
        await syncNotes(db);
        await loadNotes();
      } catch (e) {
        console.error('Initial sync failed:', e);
      }
    };

    init();

    // 3. Listen for AppState changes to sync on resume
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      if (nextAppState === 'active') {
        try {
          const db = await getDb();
          await syncNotes(db);
          await loadNotes();
        } catch (e) {
          console.error('Resume sync failed:', e);
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [loadNotes]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    Animated.timing(selectionHeaderAnim, {
      toValue: selectionMode ? 1 : 0,
      duration: 240,
      useNativeDriver: true,
    }).start();
  }, [selectionHeaderAnim, selectionMode]);

  useEffect(() => {
    if (selectedNoteIds.size === 0) return;
    const currentIds = new Set(notes.map((n) => n.id));
    setSelectedNoteIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (currentIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [notes, selectedNoteIds.size]);

  const showToast = useCallback((message: string, isError: boolean) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ show: true, message, isError });
    toastTimeoutRef.current = setTimeout(() => {
      setToast((prev) => (prev.show ? { ...prev, show: false } : prev));
      toastTimeoutRef.current = null;
    }, 1000);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedNoteIds(new Set());
  }, []);

  const handleNoteLongPress = useCallback((noteId: string) => {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }, []);

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

        // Set editor state directly to avoid dependency issues
        setEditingNote(note);
        setTitle(note.title || '');
        setContent(note.content || '');

        const effectiveTriggerAt = note.snoozedUntil ?? note.nextTriggerAt ?? note.triggerAt;
        if (effectiveTriggerAt) {
          setReminder(new Date(effectiveTriggerAt));
          setRepeat(note.repeat || null);
        } else {
          setReminder(null);
          setRepeat(null);
        }

        setModalVisible(true);
      } finally {
        onEditHandled?.();
      }
    };

    openEditFlow();

    return () => {
      cancelled = true;
    };
  }, [editNoteId, onEditHandled]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const db = await getDb();
      await syncNotes(db);
    } catch (e) {
      console.error('Sync failed:', e);
    }
    loadNotes();
  };

  const handleReminderPress = () => {
    setShowReminderModal(true);
  };

  const handleReminderSave = (date: Date, newRepeat: RepeatRule | null) => {
    setReminder(date);
    setRepeat(newRepeat);
    setShowReminderModal(false);
  };

  const formatReminder = (date: Date, repeatRule: RepeatRule | null) => {
    const timeStr = date.toLocaleString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    if (repeatRule) {
      const ruleLabel =
        repeatRule.kind === 'custom' &&
        repeatRule.frequency === 'minutes' &&
        repeatRule.interval === 3
          ? 'Every 3 min'
          : repeatRule.kind.charAt(0).toUpperCase() + repeatRule.kind.slice(1);
      return `${timeStr} (${ruleLabel})`;
    }
    return timeStr;
  };

  const openEditor = (note?: Note) => {
    if (note) {
      setEditingNote(note);
      setTitle(note.title || '');
      setContent(note.content || '');
      const effectiveTriggerAt = note.snoozedUntil ?? note.nextTriggerAt ?? note.triggerAt;
      if (effectiveTriggerAt) {
        setReminder(new Date(effectiveTriggerAt));
        setRepeat(note.repeat || null);
      } else {
        setReminder(null);
        setRepeat(null);
      }
    } else {
      setEditingNote(null);
      setTitle('');
      setContent('');
      setReminder(null);
      setRepeat(null);
    }
    setModalVisible(true);
  };

  const closeEditor = useCallback(() => {
    setModalVisible(false);
    setEditingNote(null);
    setTitle('');
    setContent('');
    setReminder(null);
    setRepeat(null);
  }, []);

  useEffect(() => {
    if (modalVisible) {
      editorTranslateY.setValue(0);
    }
  }, [editorTranslateY, modalVisible]);

  const closeEditorFromGesture = useCallback(() => {
    Animated.timing(editorTranslateY, {
      toValue: 600,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      editorTranslateY.setValue(0);
      closeEditor();
    });
  }, [closeEditor, editorTranslateY]);

  const handleEditorTouchStart = useCallback(
    (e: { nativeEvent: { pageX: number; pageY: number } }) => {
      editorTouchStartRef.current = {
        x: e.nativeEvent.pageX,
        y: e.nativeEvent.pageY,
        timeMs: Date.now(),
      };
      editorDraggingRef.current = false;
    },
    [],
  );

  const handleEditorTouchMove = useCallback(
    (e: { nativeEvent: { pageX: number; pageY: number } }) => {
      const start = editorTouchStartRef.current;
      if (!start) return;
      const dx = e.nativeEvent.pageX - start.x;
      const dy = e.nativeEvent.pageY - start.y;
      if (dy <= 0) return;

      if (!editorDraggingRef.current) {
        if (Math.abs(dy) < 12) return;
        if (Math.abs(dy) <= Math.abs(dx)) return;
        editorDraggingRef.current = true;
      }

      editorTranslateY.setValue(dy);
    },
    [editorTranslateY],
  );

  const handleEditorTouchEnd = useCallback(() => {
    const start = editorTouchStartRef.current;
    if (!start) return;
    editorTouchStartRef.current = null;

    if (!editorDraggingRef.current) return;
    editorDraggingRef.current = false;

    editorTranslateY.stopAnimation((value) => {
      const dtMs = Math.max(1, Date.now() - start.timeMs);
      const vy = value / dtMs;
      const shouldClose = value > 140 || vy > 0.9;
      if (shouldClose) {
        closeEditorFromGesture();
        return;
      }
      Animated.spring(editorTranslateY, { toValue: 0, useNativeDriver: true }).start();
    });
  }, [closeEditorFromGesture, editorTranslateY]);

  const openDeleteConfirm = useCallback((noteIds: string[]) => {
    if (noteIds.length === 0) return;
    setDeleteConfirm({ visible: true, noteIds });
  }, []);

  const closeDeleteConfirm = useCallback(() => {
    setDeleteConfirm({ visible: false, noteIds: [] });
  }, []);

  const saveNote = async () => {
    try {
      if (!title.trim() && !content.trim()) {
        closeEditor();
        return;
      }

      const db = await getDb();
      const now = Date.now();
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

      const noteToSave: Note = {
        id: editingNote ? editingNote.id : uuid.v4().toString(),
        title: title.trim(),
        content: content.trim(),
        color: editingNote?.color || theme.colors.surface,
        active: true,
        done: reminder ? false : (editingNote?.done ?? false),

        // Unified Reminder Logic
        triggerAt: reminder ? reminder.getTime() : undefined,
        repeatRule: reminder && repeat ? 'custom' : undefined, // Legacy fallback
        repeatConfig: reminder && repeat ? { ...repeat } : undefined, // Legacy fallback
        repeat: reminder ? repeat : undefined, // New source of truth
        snoozedUntil: reminder ? undefined : undefined,
        scheduleStatus: reminder ? 'unscheduled' : undefined, // Reset to unscheduled on save needed?
        timezone: reminder ? timezone : undefined,

        createdAt: editingNote ? editingNote.createdAt : now,
        updatedAt: now,
      };

      await saveNoteOffline(db, noteToSave, editingNote ? 'update' : 'create');

      await syncNotes(db);
      await loadNotes();
      closeEditor();
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Failed to save note');
    }
  };

  const handleDelete = () => {
    if (!editingNote) return;
    openDeleteConfirm([editingNote.id]);
  };

  const confirmDelete = useCallback(() => {
    const ids = deleteConfirm.noteIds;
    if (ids.length === 0) return;
    closeDeleteConfirm();

    void (async () => {
      try {
        const db = await getDb();
        const toDelete = notes.filter((n) => ids.includes(n.id));
        for (const note of toDelete) {
          await deleteNoteOffline(db, note);
        }
        await syncNotes(db);
        await loadNotes();
        if (editingNote?.id && ids.includes(editingNote.id)) closeEditor();
        if (selectionMode && ids.some((id) => selectedNoteIds.has(id))) clearSelection();
        showToast('Deleted', false);
      } catch (e) {
        console.error(e);
        showToast('Failed to delete', true);
      }
    })();
  }, [
    clearSelection,
    closeDeleteConfirm,
    closeEditor,
    deleteConfirm.noteIds,
    editingNote?.id,
    loadNotes,
    notes,
    selectedNoteIds,
    selectionMode,
    showToast,
  ]);

  const handleNoteDone = useCallback(
    async (noteId: string) => {
      const note = notes.find((n) => n.id === noteId);
      if (!note) return;

      try {
        const db = await getDb();
        const updated: Note = note.done
          ? { ...note, done: false, updatedAt: Date.now() }
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
              updatedAt: Date.now(),
            };

        await saveNoteOffline(db, updated, 'update');
        await syncNotes(db);
        await loadNotes();
        showToast(note.done ? 'Marked undone' : 'Marked done', false);
      } catch (e) {
        console.error(e);
        showToast('Failed to update done', true);
      }
    },
    [loadNotes, notes, showToast],
  );

  const handleNoteReschedule = useCallback((noteId: string) => {
    setRescheduleTargetId(noteId);
    setShowRescheduleModal(true);
  }, []);

  const handleNoteDelete = useCallback(
    (noteId: string) => {
      openDeleteConfirm([noteId]);
    },
    [openDeleteConfirm],
  );

  const handleBulkDeleteSelected = useCallback(() => {
    openDeleteConfirm(Array.from(selectedNoteIds));
  }, [openDeleteConfirm, selectedNoteIds]);

  const handleBulkMarkDone = useCallback(() => {
    const ids = Array.from(selectedNoteIds);
    const toUpdate = notes.filter((n) => ids.includes(n.id));
    if (toUpdate.length === 0) return;

    void (async () => {
      try {
        const db = await getDb();
        const now = Date.now();
        for (const note of toUpdate) {
          if (note.done) continue;
          const updated: Note = {
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
          await saveNoteOffline(db, updated, 'update');
        }
        await syncNotes(db);
        await loadNotes();
        clearSelection();
        showToast('Marked done', false);
      } catch (e) {
        console.error(e);
        showToast('Failed to update done', true);
      }
    })();
  }, [clearSelection, loadNotes, notes, selectedNoteIds, showToast]);

  const closeReschedule = useCallback(() => {
    setShowRescheduleModal(false);
    setRescheduleTargetId(null);
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={[styles.header, selectionMode && styles.headerHidden]}>
        <Text style={styles.headerTitle}>My Notes</Text>
        <Pressable
          style={styles.iconButton}
          onPress={() => setViewMode((prev) => (prev === 'grid' ? 'list' : 'grid'))}
        >
          <Ionicons
            name={viewMode === 'grid' ? 'list' : 'grid'}
            size={24}
            color={theme.colors.primary}
          />
        </Pressable>
      </View>

      <Animated.View
        pointerEvents={selectionMode ? 'auto' : 'none'}
        style={[
          styles.selectionHeader,
          {
            opacity: selectionHeaderAnim,
            transform: [
              {
                translateY: selectionHeaderAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-SELECTION_HEADER_HEIGHT, 0],
                }),
              },
            ],
          },
        ]}
      >
        <View style={styles.selectionHeaderContent}>
          <Text style={styles.selectionHeaderTitle}>{selectedNoteIds.size} selected</Text>
          {selectedNoteIds.size >= 2 && (
            <View style={styles.selectionHeaderActions}>
              <Pressable style={styles.selectionHeaderButton} onPress={handleBulkDeleteSelected}>
                <Ionicons name="trash-outline" size={22} color={theme.colors.error} />
              </Pressable>
              <Pressable style={styles.selectionHeaderButton} onPress={clearSelection}>
                <Ionicons name="close" size={24} color={theme.colors.text} />
              </Pressable>
              <Pressable style={styles.selectionHeaderButton} onPress={handleBulkMarkDone}>
                <Ionicons name="checkmark" size={26} color={theme.colors.primary} />
              </Pressable>
            </View>
          )}
        </View>
      </Animated.View>

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
            onNotePress={(id) => openEditor(notes.find((n) => n.id === id))}
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
      <Pressable style={styles.fab} onPress={() => openEditor()}>
        <Ionicons name="add" size={32} color="white" />
      </Pressable>

      {/* Editor Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={closeEditor}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={closeEditor} />
          <Animated.View
            style={[
              styles.modalContent,
              {
                transform: [{ translateY: editorTranslateY }],
              },
            ]}
            onTouchStart={handleEditorTouchStart}
            onTouchMove={handleEditorTouchMove}
            onTouchEnd={handleEditorTouchEnd}
            onTouchCancel={handleEditorTouchEnd}
          >
            <View style={styles.sheetHandleHitArea}>
              <View style={styles.sheetHandle} />
            </View>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingNote ? 'Edit Note' : 'New Note'}</Text>

              <View style={styles.headerRight}>
                {reminder && (
                  <View style={styles.headerChip}>
                    <Text style={styles.headerChipText}>{formatReminder(reminder, repeat)}</Text>
                    <Pressable
                      onPress={() => {
                        setReminder(null);
                        setRepeat(null);
                      }}
                      hitSlop={8}
                    >
                      <Ionicons name="close-circle" size={16} color={theme.colors.text} />
                    </Pressable>
                  </View>
                )}
                <Pressable style={styles.iconButton} onPress={handleReminderPress}>
                  <Ionicons
                    name={reminder ? 'alarm' : 'alarm-outline'}
                    size={24}
                    color={theme.colors.text}
                  />
                </Pressable>
                <Pressable onPress={closeEditor} style={styles.iconButton}>
                  <Ionicons name="close" size={24} color={theme.colors.text} />
                </Pressable>
              </View>
            </View>

            <TextInput
              style={styles.inputTitle}
              placeholder="Title"
              value={title}
              onChangeText={setTitle}
              placeholderTextColor={theme.colors.textMuted}
            />
            <TextInput
              style={styles.inputContent}
              placeholder="Start typing..."
              value={content}
              onChangeText={setContent}
              multiline
              textAlignVertical="top"
              placeholderTextColor={theme.colors.textMuted}
            />

            <View style={styles.modalActions}>
              {editingNote && (
                <Pressable style={[styles.button, styles.buttonDelete]} onPress={handleDelete}>
                  <Ionicons name="trash-outline" size={20} color={theme.colors.error} />
                </Pressable>
              )}
              <View style={{ flex: 1 }} />
              <Pressable style={[styles.button, styles.buttonCancel]} onPress={closeEditor}>
                <Text style={styles.buttonTextCancel}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.button, styles.buttonSave]} onPress={saveNote}>
                <Text style={styles.buttonTextSave}>Save</Text>
              </Pressable>
            </View>

            {showReminderModal && (
              <ReminderSetupModal
                visible={showReminderModal}
                initialDate={reminder}
                initialRepeat={repeat}
                onClose={() => setShowReminderModal(false)}
                onSave={handleReminderSave}
              />
            )}
          </Animated.View>
        </View>
      </Modal>

      {rescheduleTargetId && (
        <RescheduleModal
          visible={showRescheduleModal}
          noteId={rescheduleTargetId}
          onClose={closeReschedule}
          onSaveStart={closeReschedule}
          onRescheduled={(noteId, snoozedUntil) => {
            const now = Date.now();
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
            if (editingNote?.id === noteId) {
              setEditingNote({
                ...editingNote,
                done: false,
                snoozedUntil,
                triggerAt: snoozedUntil,
                nextTriggerAt: snoozedUntil,
                scheduleStatus: 'scheduled',
                active: true,
                updatedAt: now,
              });
              setReminder(new Date(snoozedUntil));
            }
            void loadNotes();
            showToast('Rescheduled successfully', false);
          }}
          onError={() => {
            showToast('Failed to reschedule', true);
          }}
        />
      )}

      <Modal
        animationType="fade"
        transparent
        visible={deleteConfirm.visible}
        onRequestClose={closeDeleteConfirm}
      >
        <Pressable style={styles.confirmOverlay} onPress={closeDeleteConfirm}>
          <Pressable style={styles.confirmCard} onPress={() => {}}>
            <Text style={styles.confirmTitle}>{deleteConfirmTitle}</Text>
            <Text style={styles.confirmMessage}>{deleteConfirmMessage}</Text>
            <View style={styles.confirmActions}>
              <Pressable
                style={[styles.confirmButton, styles.confirmCancel]}
                onPress={closeDeleteConfirm}
              >
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.confirmButton, styles.confirmDelete]}
                onPress={confirmDelete}
              >
                <Text style={styles.confirmDeleteText}>Delete</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {toast.show && (
        <View style={styles.toastContainer} pointerEvents="none">
          <View style={[styles.toast, toast.isError && styles.toastError]}>
            <Text style={styles.toastText}>{toast.message}</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    padding: theme.spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerTitle: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold as '700',
    color: theme.colors.text,
    fontFamily: theme.typography.fontFamily,
  },
  iconButton: {
    padding: theme.spacing.xs,
  },
  headerHidden: {
    opacity: 0,
  },
  selectionHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: SELECTION_HEADER_HEIGHT,
    paddingHorizontal: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  selectionHeaderContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectionHeaderTitle: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.semibold as '600',
    color: theme.colors.text,
    fontFamily: theme.typography.fontFamily,
  },
  selectionHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  selectionHeaderButton: {
    padding: theme.spacing.xs,
    borderRadius: theme.borderRadius.md,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contentPressable: {
    flex: 1,
  },
  fab: {
    position: 'absolute',
    bottom: theme.spacing.xl,
    right: theme.spacing.xl,
    backgroundColor: theme.colors.primary,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    ...theme.shadows.md,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.borderRadius.xl,
    borderTopRightRadius: theme.borderRadius.xl,
    padding: theme.spacing.lg,
    height: '80%',
    ...theme.shadows.md,
  },
  sheetHandleHitArea: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingBottom: theme.spacing.md,
    paddingTop: theme.spacing.xs,
  },
  sheetHandle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: theme.colors.border,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
  },
  modalTitle: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold as '700',
    color: theme.colors.text,
  },
  inputTitle: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.semibold as '600',
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
    padding: theme.spacing.sm,
  },
  inputContent: {
    fontSize: theme.typography.sizes.base,
    color: theme.colors.text,
    flex: 1,
    padding: theme.spacing.sm,
  },
  modalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.spacing.md,
    gap: theme.spacing.md,
  },
  button: {
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSave: {
    backgroundColor: theme.colors.primary,
  },
  buttonCancel: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  buttonDelete: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: theme.spacing.md,
  },
  buttonTextSave: {
    color: 'white',
    fontWeight: '600',
  },
  buttonTextCancel: {
    color: theme.colors.text,
    fontWeight: '600',
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.border,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.sm,
    gap: 4,
  },
  headerChipText: {
    fontSize: 12, // Smaller font for header
    color: theme.colors.text,
    fontWeight: '500',
  },
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: theme.spacing.md,
  },
  confirmCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    ...theme.shadows.md,
  },
  confirmTitle: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold as '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  confirmMessage: {
    fontSize: theme.typography.sizes.base,
    color: theme.colors.text,
    marginBottom: theme.spacing.lg,
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: theme.spacing.md,
  },
  confirmButton: {
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.borderRadius.md,
  },
  confirmCancel: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  confirmDelete: {
    backgroundColor: theme.colors.error,
  },
  confirmCancelText: {
    color: theme.colors.text,
    fontWeight: '600',
  },
  confirmDeleteText: {
    color: 'white',
    fontWeight: '600',
  },
});
