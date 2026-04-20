import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { ArrowUp } from 'lucide-react';
import {
  useNotes,
  useSyncNotes,
  usePermanentlyDeleteNote,
  useEmptyTrash,
  NOTES_POLL_INTERVAL_MS,
  requestNotesRefresh,
  createNote,
  updateNote,
  deleteNote,
  restoreNote,
  getResolvedTimezone,
} from '../services/notes';
import { useDebouncedValue } from '../../../../packages/shared/hooks/useDebouncedValue';
import { uuidv4 } from '../../../../packages/shared/utils/uuid';
import type { NoteEditorDraft, NotesViewMode, WebNote } from '../services/notesTypes';
import {
  emptyDraft,
  draftFromNote,
  filterActive,
  filterBySearchQuery,
  sortNotes,
} from '../services/notesUtils';
import { buildReminderSyncFields } from '../services/reminderUtils';
import { NotesList } from '../components/NotesList';
import { NoteEditorModal } from '../components/NoteEditorModal';
import { useWebAuth } from '../auth/AuthContext';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface NotesPageProps {
  viewMode: NotesViewMode;
  viewingTrash: boolean;
  newNoteTrigger: number;
  searchQuery: string;
  onSaveStatusChange: (status: SaveStatus) => void;
  onTrashCountChange: (count: number) => void;
}

export default function NotesPage({
  viewMode,
  viewingTrash,
  newNoteTrigger,
  searchQuery,
  onSaveStatusChange,
  onTrashCountChange,
}: NotesPageProps): JSX.Element {
  const { userId, isAuthenticated } = useWebAuth();
  const allNotes = useNotes();
  const sync = useSyncNotes();
  const permanentlyDeleteNoteMutation = usePermanentlyDeleteNote();
  const emptyTrashMutation = useEmptyTrash();

  const [showScrollTop, setShowScrollTop] = useState(false);
  const scrollTopVisibleRef = useRef(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<NoteEditorDraft>(emptyDraft());
  const [editingNote, setEditingNote] = useState<WebNote | null>(null);
  const [optimisticNotes, setOptimisticNotes] = useState<WebNote[] | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 250);

  // Active notes (for main view)
  const serverNotes = useMemo<WebNote[] | undefined>(() => {
    if (allNotes === undefined) return undefined;
    return sortNotes(filterActive(allNotes));
  }, [allNotes]);

  // Trash notes
  const trashNotes = useMemo<WebNote[]>(() => {
    if (allNotes === undefined) return [];
    return allNotes
      .filter((n) => n.active === false)
      .sort((a, b) => (b.deletedAt ?? b.updatedAt) - (a.deletedAt ?? a.updatedAt));
  }, [allNotes]);

  const displayNotes = useMemo<WebNote[]>(
    () => optimisticNotes ?? serverNotes ?? [],
    [optimisticNotes, serverNotes],
  );
  const filteredNotes = useMemo(
    () => filterBySearchQuery(displayNotes, debouncedSearchQuery),
    [displayNotes, debouncedSearchQuery],
  );
  const filteredTrashNotes = useMemo(
    () => filterBySearchQuery(trashNotes, debouncedSearchQuery),
    [trashNotes, debouncedSearchQuery],
  );

  useEffect(() => {
    if (newNoteTrigger > 0) {
      setDraft(emptyDraft());
      setEditingNote(null);
      setModalOpen(true);
    }
  }, [newNoteTrigger]);

  useEffect(() => {
    onTrashCountChange(trashNotes.length);
  }, [trashNotes.length, onTrashCountChange]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const handleFocus = () => {
      requestNotesRefresh();
    };

    requestNotesRefresh();
    window.addEventListener('focus', handleFocus);
    const intervalId = window.setInterval(() => {
      requestNotesRefresh();
    }, NOTES_POLL_INTERVAL_MS);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.clearInterval(intervalId);
    };
  }, [isAuthenticated]);

  useEffect(() => {
    onSaveStatusChange(saveStatus);
  }, [onSaveStatusChange, saveStatus]);

  const handleCardClick = useCallback((note: WebNote) => {
    setDraft(draftFromNote(note));
    setEditingNote(note);
    setModalOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setModalOpen(false);
  }, []);

  const handleSave = useCallback(
    async (draftOverride?: NoteEditorDraft) => {
      const effectiveDraft = draftOverride ?? draft;
      const isNew = !editingNote;
      const isEmpty = !effectiveDraft.title.trim() && !effectiveDraft.content.trim();
      if (isNew && isEmpty) {
        setModalOpen(false);
        return;
      }

      // Capture rollback snapshot before any optimistic mutation
      const snapshot: WebNote[] = optimisticNotes ?? serverNotes ?? [];
      let draftForMutation = effectiveDraft;
      const nowDate = new Date();
      const reminderFields = buildReminderSyncFields(
        effectiveDraft.done
          ? { reminder: null, repeat: null }
          : { reminder: effectiveDraft.reminder, repeat: effectiveDraft.repeat },
        nowDate,
        getResolvedTimezone(),
        isNew ? undefined : editingNote,
      );

      if (isNew) {
        const newId = uuidv4();
        const now = Date.now();
        const optimisticNote: WebNote = {
          id: newId,
          userId,
          title: effectiveDraft.title || null,
          content: effectiveDraft.content || null,
          color: effectiveDraft.color,
          active: true,
          done: effectiveDraft.done,
          isPinned: effectiveDraft.isPinned,
          triggerAt: reminderFields.triggerAt,
          repeatRule: reminderFields.repeatRule,
          repeatConfig: reminderFields.repeatConfig,
          repeat: reminderFields.repeat,
          startAt: reminderFields.startAt ?? null,
          baseAtLocal: reminderFields.baseAtLocal ?? null,
          nextTriggerAt: reminderFields.nextTriggerAt ?? null,
          snoozedUntil: reminderFields.snoozedUntil,
          scheduleStatus: reminderFields.scheduleStatus,
          timezone: reminderFields.timezone,
          updatedAt: now,
          createdAt: now,
        };
        draftForMutation = { ...effectiveDraft, id: newId };
        setOptimisticNotes(sortNotes([optimisticNote, ...snapshot]));
      } else if (editingNote) {
        const now = Date.now();
        const updated: WebNote = {
          ...editingNote,
          title: effectiveDraft.title || null,
          content: effectiveDraft.content || null,
          color: effectiveDraft.color,
          done: effectiveDraft.done,
          isPinned: effectiveDraft.isPinned,
          triggerAt: reminderFields.triggerAt,
          repeatRule: reminderFields.repeatRule,
          repeatConfig: reminderFields.repeatConfig,
          repeat: reminderFields.repeat,
          startAt: reminderFields.startAt ?? null,
          baseAtLocal: reminderFields.baseAtLocal ?? null,
          nextTriggerAt: reminderFields.nextTriggerAt ?? null,
          snoozedUntil: reminderFields.snoozedUntil,
          scheduleStatus: reminderFields.scheduleStatus,
          timezone: reminderFields.timezone,
          updatedAt: now,
        };
        setOptimisticNotes(sortNotes(snapshot.map((n) => (n.id === editingNote.id ? updated : n))));
      }

      setModalOpen(false);
      setSaveStatus('saving');

      try {
        if (isNew) {
          await createNote(sync, userId, draftForMutation);
        } else {
          await updateNote(sync, userId, effectiveDraft, editingNote!);
        }
        setOptimisticNotes(null);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch {
        setOptimisticNotes(snapshot);
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 3000);
      }
    },
    [draft, editingNote, optimisticNotes, serverNotes, sync, userId],
  );

  const handleDelete = useCallback(async () => {
    if (!editingNote) return;
    const snapshot: WebNote[] = optimisticNotes ?? serverNotes ?? [];
    setOptimisticNotes(snapshot.filter((n) => n.id !== editingNote.id));
    setModalOpen(false);
    setSaveStatus('saving');

    try {
      await deleteNote(sync, userId, editingNote.id);
      setOptimisticNotes(null);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setOptimisticNotes(snapshot);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }, [editingNote, optimisticNotes, serverNotes, sync, userId]);

  const handleToggleDone = useCallback(
    async (note: WebNote) => {
      const snapshot: WebNote[] = optimisticNotes ?? serverNotes ?? [];
      const now = Date.now();
      const toggledDone = !note.done;

      setOptimisticNotes(
        sortNotes(
          snapshot.map((n) =>
            n.id === note.id
              ? {
                  ...n,
                  done: toggledDone,
                  triggerAt: toggledDone ? undefined : n.triggerAt,
                  repeatRule: toggledDone ? 'none' : n.repeatRule,
                  repeatConfig: toggledDone ? null : n.repeatConfig,
                  repeat: toggledDone ? null : n.repeat,
                  startAt: toggledDone ? null : n.startAt,
                  baseAtLocal: toggledDone ? null : n.baseAtLocal,
                  nextTriggerAt: toggledDone ? null : n.nextTriggerAt,
                  snoozedUntil: toggledDone ? undefined : n.snoozedUntil,
                  scheduleStatus: toggledDone ? undefined : n.scheduleStatus,
                  updatedAt: now,
                }
              : n,
          ),
        ),
      );
      setSaveStatus('saving');

      const baseDraft = draftFromNote(note);
      const toggleDraft = {
        ...baseDraft,
        done: toggledDone,
        reminder: toggledDone ? null : baseDraft.reminder,
        repeat: toggledDone ? null : baseDraft.repeat,
      };

      try {
        await updateNote(sync, userId, toggleDraft, note);
        setOptimisticNotes(null);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch {
        setOptimisticNotes(snapshot);
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 3000);
      }
    },
    [optimisticNotes, serverNotes, sync, userId],
  );

  const handleTogglePin = useCallback(
    async (note: WebNote) => {
      const snapshot: WebNote[] = optimisticNotes ?? serverNotes ?? [];
      const now = Date.now();
      const toggledPin = !note.isPinned;

      setOptimisticNotes(
        sortNotes(
          snapshot.map((n) =>
            n.id === note.id
              ? {
                  ...n,
                  isPinned: toggledPin,
                  updatedAt: now,
                }
              : n,
          ),
        ),
      );
      setSaveStatus('saving');

      const toggleDraft = {
        ...draftFromNote(note),
        isPinned: toggledPin,
      };

      try {
        await updateNote(sync, userId, toggleDraft, note);
        setOptimisticNotes(null);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch {
        setOptimisticNotes(snapshot);
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 3000);
      }
    },
    [optimisticNotes, serverNotes, sync, userId],
  );

  const handleDeleteFromCard = useCallback(
    async (note: WebNote) => {
      const snapshot: WebNote[] = optimisticNotes ?? serverNotes ?? [];
      setOptimisticNotes(snapshot.filter((n) => n.id !== note.id));
      setSaveStatus('saving');

      try {
        await deleteNote(sync, userId, note.id);
        setOptimisticNotes(null);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch {
        setOptimisticNotes(snapshot);
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 3000);
      }
    },
    [optimisticNotes, serverNotes, sync, userId],
  );

  useEffect(() => {
    const updateVisibility = () => {
      const shouldShow = window.scrollY > 200;
      if (scrollTopVisibleRef.current === shouldShow) return;
      scrollTopVisibleRef.current = shouldShow;
      setShowScrollTop(shouldShow);
    };

    updateVisibility();
    window.addEventListener('scroll', updateVisibility, { passive: true });
    return () => {
      window.removeEventListener('scroll', updateVisibility);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Trash actions
  // ---------------------------------------------------------------------------

  const handleRestoreNote = useCallback(
    async (note: WebNote) => {
      setSaveStatus('saving');
      try {
        await restoreNote(sync, userId, note);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch {
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 3000);
      }
    },
    [sync, userId],
  );

  const handlePermanentDelete = useCallback(
    async (note: WebNote) => {
      setSaveStatus('saving');
      try {
        await permanentlyDeleteNoteMutation({ userId, noteId: note.id });
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch {
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 3000);
      }
    },
    [permanentlyDeleteNoteMutation, userId],
  );

  const handleEmptyTrash = useCallback(async () => {
    if (!window.confirm(`Permanently delete ${trashNotes.length} note(s)? This cannot be undone.`))
      return;
    setSaveStatus('saving');
    try {
      await emptyTrashMutation({ userId });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }, [emptyTrashMutation, trashNotes.length, userId]);

  return (
    <main className="notes-page">
      {viewingTrash ? (
        <TrashView
          notes={filteredTrashNotes}
          totalCount={trashNotes.length}
          searchQuery={debouncedSearchQuery}
          viewMode={viewMode}
          onRestore={handleRestoreNote}
          onDeleteForever={handlePermanentDelete}
          onEmptyTrash={handleEmptyTrash}
        />
      ) : (
        <>
          {serverNotes === undefined ? (
            <p className="notes-page__loading">Loading…</p>
          ) : (
            <NotesList
              notes={filteredNotes}
              viewMode={viewMode}
              onCardClick={handleCardClick}
              onToggleDone={handleToggleDone}
              onTogglePin={handleTogglePin}
              onDelete={handleDeleteFromCard}
              searchQuery={debouncedSearchQuery}
            />
          )}

          {modalOpen && (
            <NoteEditorModal
              draft={draft}
              onChange={setDraft}
              onSave={handleSave}
              onDelete={handleDelete}
              onClose={handleClose}
              isNew={!editingNote}
            />
          )}
        </>
      )}

      {showScrollTop && (
        <button
          className="notes-scroll-top"
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Scroll to top"
          title="Scroll to top"
        >
          <ArrowUp size={22} />
        </button>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Trash View component (inline)
// ---------------------------------------------------------------------------

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

function getDaysRemaining(deletedAt: number | undefined, updatedAt: number): number {
  const ref = deletedAt ?? updatedAt;
  const elapsed = Date.now() - ref;
  return Math.max(0, Math.ceil((FOURTEEN_DAYS_MS - elapsed) / (24 * 60 * 60 * 1000)));
}

function TrashView({
  notes,
  totalCount,
  searchQuery,
  viewMode,
  onRestore,
  onDeleteForever,
  onEmptyTrash,
}: {
  notes: WebNote[];
  totalCount: number;
  searchQuery: string;
  viewMode: NotesViewMode;
  onRestore: (note: WebNote) => void;
  onDeleteForever: (note: WebNote) => void;
  onEmptyTrash: () => void;
}) {
  if (notes.length === 0) {
    if (totalCount > 0 && searchQuery.trim().length > 0) {
      return (
        <div className="trash-empty">
          <p className="trash-empty__text">No deleted notes match your search.</p>
        </div>
      );
    }

    return (
      <div className="trash-empty">
        <p className="trash-empty__text">Trash is empty</p>
        <p className="trash-empty__subtext">
          Deleted notes will appear here for 14 days before being permanently removed.
        </p>
      </div>
    );
  }

  return (
    <div className="trash-view">
      <div className="trash-view__toolbar">
        <span className="trash-view__count">
          {notes.length} deleted note{notes.length !== 1 ? 's' : ''}
        </span>
        <button className="trash-view__empty-btn" onClick={onEmptyTrash}>
          Empty Trash
        </button>
      </div>
      <div className={`trash-view__list trash-view__list--${viewMode}`}>
        {notes.map((note) => {
          const daysLeft = getDaysRemaining(note.deletedAt, note.updatedAt);
          return (
            <div key={note.id} className="trash-card-slot">
              <div className="trash-card">
                <div className="trash-card__content">
                  {note.title && <div className="trash-card__title">{note.title}</div>}
                  {note.content && (
                    <div className="trash-card__body">
                      {note.content.length > 120 ? note.content.slice(0, 120) + '…' : note.content}
                    </div>
                  )}
                  <div className="trash-card__meta">
                    {daysLeft === 0
                      ? 'Expiring today'
                      : `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left`}
                  </div>
                </div>
                <div className="trash-card__actions">
                  <button className="trash-card__restore-btn" onClick={() => onRestore(note)}>
                    Restore
                  </button>
                  <button className="trash-card__delete-btn" onClick={() => onDeleteForever(note)}>
                    Delete Forever
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
