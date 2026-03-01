import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { Alert } from 'react-native';
import uuid from 'react-native-uuid';
import { getDb } from '../db/bootstrap';
import { getNoteById, listNotes, type Note } from '../db/notesRepo';
import { saveNoteOffline, deleteNoteOffline } from '../notes/editor';
import { syncNotes } from '../sync/noteSync';
import { RepeatRule } from '../../../../packages/shared/types/reminder';
import { buildCanonicalRecurrenceFields } from '../../../../packages/shared/utils/repeatCodec';

type EditorState = {
  editingNote: Note | null;
  title: string;
  content: string;
  reminder: Date | null;
  repeat: RepeatRule | null;
  isPinned: boolean;
  color: string | null;
};

type UseNoteActionsParams = {
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
      await syncNotes(db);
    } catch (e) {
      console.error('Sync failed:', e);
    }
    loadNotes();
  }, [loadNotes]);

  const saveNote = useCallback(
    async (editorState: EditorState) => {
      const { editingNote, title, content, reminder, repeat, isPinned, color } = editorState;

      if (!title.trim() && !content.trim()) {
        closeEditor();
        return;
      }

      const now = Date.now();
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

      const noteToSave: Note = {
        id: editingNote ? editingNote.id : uuid.v4().toString(),
        title: title.trim(),
        content: content.trim(),
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
        await saveNoteOffline(db, noteToSave, editingNote ? 'update' : 'create');
        await syncNotes(db);
        notifyActionSuccess();
      } catch (e) {
        console.error(e);
        notifyActionError('Failed to save note');
        loadNotes();
      }
    },
    [closeEditor, loadNotes, notifyActionError, notifyActionPending, notifyActionSuccess, setNotes],
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
              await deleteNoteOffline(db, noteToDelete);
            }
          }

          await syncNotes(db);
          notifyActionSuccess();
        } catch (e) {
          console.error(e);
          notifyActionError('Failed to delete');
          loadNotes();
        }
      })();
    },
    [loadNotes, notifyActionError, notifyActionPending, notifyActionSuccess, showToast],
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

      setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)));
      showToast(note.done ? 'Marked undone' : 'Marked done', false);

      notifyActionPending();
      void (async () => {
        try {
          const db = await getDb();
          await saveNoteOffline(db, updated, 'update');
          await syncNotes(db);
          notifyActionSuccess();
        } catch (e) {
          console.error(e);
          notifyActionError('Failed to update done');
          loadNotes();
        }
      })();
    },
    [loadNotes, notes, notifyActionError, notifyActionPending, notifyActionSuccess, showToast],
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
