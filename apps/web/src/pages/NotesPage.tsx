import React, { useState, useCallback } from 'react';
import {
  useNotes,
  useSyncNotes,
  createNote,
  updateNote,
  deleteNote,
  getResolvedTimezone,
} from '../services/notes';
import type { NoteEditorDraft, NotesViewMode, WebNote } from '../services/notesTypes';
import { emptyDraft, draftFromNote, sortNotes } from '../services/notesUtils';
import { buildReminderSyncFields } from '../services/reminderUtils';
import { NotesHeader } from '../components/NotesHeader';
import { NotesList } from '../components/NotesList';
import { NoteEditorModal } from '../components/NoteEditorModal';
import type { ThemeMode } from '../services/theme';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface NotesPageProps {
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
}

export default function NotesPage({ themeMode, onThemeModeChange }: NotesPageProps): JSX.Element {
  const serverNotes = useNotes();
  const sync = useSyncNotes();

  const [viewMode, setViewMode] = useState<NotesViewMode>('grid');
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<NoteEditorDraft>(emptyDraft());
  const [editingNote, setEditingNote] = useState<WebNote | null>(null);
  const [optimisticNotes, setOptimisticNotes] = useState<WebNote[] | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  const displayNotes: WebNote[] = optimisticNotes ?? serverNotes ?? [];

  const handleNewNote = useCallback(() => {
    setDraft(emptyDraft());
    setEditingNote(null);
    setModalOpen(true);
  }, []);

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
        const newId = crypto.randomUUID();
        const now = Date.now();
        const optimisticNote: WebNote = {
          id: newId,
          userId: 'local-user',
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
          await createNote(sync, draftForMutation);
        } else {
          await updateNote(sync, effectiveDraft, editingNote!);
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
    [draft, editingNote, optimisticNotes, serverNotes, sync],
  );

  const handleDelete = useCallback(async () => {
    if (!editingNote) return;
    const snapshot: WebNote[] = optimisticNotes ?? serverNotes ?? [];
    setOptimisticNotes(snapshot.filter((n) => n.id !== editingNote.id));
    setModalOpen(false);
    setSaveStatus('saving');

    try {
      await deleteNote(sync, editingNote.id);
      setOptimisticNotes(null);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setOptimisticNotes(snapshot);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }, [editingNote, optimisticNotes, serverNotes, sync]);

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
        await updateNote(sync, toggleDraft, note);
        setOptimisticNotes(null);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch {
        setOptimisticNotes(snapshot);
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 3000);
      }
    },
    [optimisticNotes, serverNotes, sync],
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
        await updateNote(sync, toggleDraft, note);
        setOptimisticNotes(null);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch {
        setOptimisticNotes(snapshot);
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 3000);
      }
    },
    [optimisticNotes, serverNotes, sync],
  );

  const handleDeleteFromCard = useCallback(
    async (note: WebNote) => {
      const snapshot: WebNote[] = optimisticNotes ?? serverNotes ?? [];
      setOptimisticNotes(snapshot.filter((n) => n.id !== note.id));
      setSaveStatus('saving');

      try {
        await deleteNote(sync, note.id);
        setOptimisticNotes(null);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch {
        setOptimisticNotes(snapshot);
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 3000);
      }
    },
    [optimisticNotes, serverNotes, sync],
  );

  return (
    <main className="notes-page">
      <NotesHeader
        viewMode={viewMode}
        onToggleView={setViewMode}
        onNewNote={handleNewNote}
        saveStatus={saveStatus}
        themeMode={themeMode}
        onThemeModeChange={onThemeModeChange}
      />

      {serverNotes === undefined ? (
        <p className="notes-page__loading">Loading…</p>
      ) : (
        <NotesList
          notes={displayNotes}
          viewMode={viewMode}
          onCardClick={handleCardClick}
          onToggleDone={handleToggleDone}
          onTogglePin={handleTogglePin}
          onDelete={handleDeleteFromCard}
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
    </main>
  );
}
