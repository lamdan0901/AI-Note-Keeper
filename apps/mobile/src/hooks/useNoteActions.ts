import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { Alert } from 'react-native';
import uuid from 'react-native-uuid';
import { getDb } from '../db/bootstrap';
import { getNoteById, listNotes, type Note } from '../db/notesRepo';
import { saveNoteOffline, deleteNoteOffline } from '../notes/editor';
import { syncNotes } from '../sync/noteSync';
import { RepeatRule } from '../../../../packages/shared/types/reminder';
import { NoteContentType } from '../../../../packages/shared/types/note';
import { buildCanonicalRecurrenceFields } from '../../../../packages/shared/utils/repeatCodec';

type EditorState = {
  editingNote: Note | null;
  title: string;
  content: string;
  contentType: NoteContentType;
  reminder: Date | null;
  repeat: RepeatRule | null;
  isPinned: boolean;
  color: string | null;
};

type UseNoteActionsParams = {
  userId: string;
  notifyActionPending: () => void;
  notifyActionSuccess: () => void;
  notifyActionError: (message: string) => void;
  lastSyncAt: number | null;
  showToast: (message: string, isError: boolean) => void;
  closeEditor: () => void;
};

type UseNoteActionsResult = {
  notes: Note[];
  setNotes: Dispatch<SetStateAction<Note[]>>;
  loading: boolean;
  refreshing: boolean;
  loadNotes: () => Promise<void>;
  handleRefresh: () => void;
  saveNote: (editorState: EditorState) => Promise<void>;
  performDelete: (ids: string[]) => void;
  handleNoteDone: (noteId: string) => void;
};

export const useNoteActions = ({
  userId,
  notifyActionPending,
  notifyActionSuccess,
  notifyActionError,
  lastSyncAt,
  showToast,
  closeEditor,
}: UseNoteActionsParams): UseNoteActionsResult => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadNotes = useCallback(async () => {
    try {
      const db = await getDb();
      const loadedNotes = await listNotes(db, 50, userId);
      setNotes(loadedNotes);
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Failed to load notes');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    if (lastSyncAt !== null) {
      console.log('[NotesScreen] Sync completed, reloading notes');
      loadNotes();
    }
  }, [lastSyncAt, loadNotes]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const db = await getDb();
      await syncNotes(db, userId);
    } catch (e) {
      console.error('Sync failed:', e);
    }
    loadNotes();
  }, [loadNotes, userId]);

  const saveNote = useCallback(
    async (editorState: EditorState) => {
      const { editingNote, title, content, contentType, reminder, repeat, isPinned, color } =
        editorState;

      if (!title.trim() && !content.trim()) {
        closeEditor();
        return;
      }

      const now = Date.now();
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

      const noteToSave: Note = {
        id: editingNote ? editingNote.id : uuid.v4().toString(),
        userId,
        title: title.trim(),
        content: content.trim(),
        contentType: contentType === 'checklist' ? 'checklist' : undefined,
        color: color || null,
        active: true,
        done: reminder ? false : (editingNote?.done ?? false),
        isPinned,

        triggerAt: reminder ? reminder.getTime() : undefined,
        snoozedUntil: undefined,
        scheduleStatus: reminder ? 'unscheduled' : undefined,
        timezone: reminder ? timezone : undefined,

        // Dual-write: canonical + proper legacy fields derived from repeat kind
        ...buildCanonicalRecurrenceFields({
          reminderAt: reminder ? reminder.getTime() : null,
          repeat: reminder ? repeat : null,
          existing: editingNote ?? undefined,
        }),

        createdAt: editingNote ? editingNote.createdAt : now,
        updatedAt: now,

        // Preserve sync-tracking fields from existing note to avoid false conflicts
        serverVersion: editingNote?.serverVersion ?? editingNote?.version ?? 0,
        version: editingNote?.version ?? editingNote?.serverVersion ?? 0,
        syncStatus: editingNote ? 'pending' : undefined,
      };

      setNotes((prev) => {
        if (editingNote) {
          return prev.map((note) => (note.id === noteToSave.id ? noteToSave : note));
        }
        return [noteToSave, ...prev];
      });

      closeEditor();

      notifyActionPending();
      try {
        const db = await getDb();
        await saveNoteOffline(db, noteToSave, editingNote ? 'update' : 'create', userId);
        await syncNotes(db, userId);
        await loadNotes();
        notifyActionSuccess();
      } catch (e) {
        console.error(e);
        notifyActionError('Failed to save note');
        loadNotes();
      }
    },
    [
      closeEditor,
      loadNotes,
      notifyActionError,
      notifyActionPending,
      notifyActionSuccess,
      setNotes,
      userId,
    ],
  );

  const performDelete = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;

      setNotes((prev) => prev.filter((note) => !ids.includes(note.id)));
      showToast('Deleted', false);

      notifyActionPending();
      void (async () => {
        try {
          const db = await getDb();
          for (const id of ids) {
            const noteToDelete = await getNoteById(db, id);
            if (noteToDelete) {
              await deleteNoteOffline(db, noteToDelete, userId);
            }
          }

          await syncNotes(db, userId);
          notifyActionSuccess();
        } catch (e) {
          console.error(e);
          notifyActionError('Failed to delete');
          loadNotes();
        }
      })();
    },
    [loadNotes, notifyActionError, notifyActionPending, notifyActionSuccess, showToast, userId],
  );

  const handleNoteDone = useCallback(
    (noteId: string) => {
      const note = notes.find((n) => n.id === noteId);
      if (!note) return;

      const now = Date.now();
      const updated: Note = note.done
        ? { ...note, done: false, updatedAt: now }
        : {
            ...note,
            active: true,
            done: true,
            triggerAt: undefined,
            repeatRule: undefined,
            repeatConfig: undefined,
            repeat: null,
            snoozedUntil: undefined,
            scheduleStatus: undefined,
            timezone: undefined,
            baseAtLocal: null,
            startAt: null,
            nextTriggerAt: null,
            lastFiredAt: null,
            lastAcknowledgedAt: null,
            updatedAt: now,
          };

      setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)));
      showToast(note.done ? 'Marked undone' : 'Marked done', false);

      notifyActionPending();
      void (async () => {
        try {
          const db = await getDb();
          await saveNoteOffline(db, updated, 'update', userId);
          await syncNotes(db, userId);
          notifyActionSuccess();
        } catch (e) {
          console.error(e);
          notifyActionError('Failed to update done');
          loadNotes();
        }
      })();
    },
    [
      loadNotes,
      notes,
      notifyActionError,
      notifyActionPending,
      notifyActionSuccess,
      showToast,
      userId,
    ],
  );

  return {
    notes,
    setNotes,
    loading,
    refreshing,
    loadNotes,
    handleRefresh,
    saveNote,
    performDelete,
    handleNoteDone,
  };
};
