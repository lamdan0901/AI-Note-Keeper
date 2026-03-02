import React from 'react';
import { Pin } from 'lucide-react';
import type { WebNote } from '../services/notesTypes';
import type { NotesViewMode } from '../services/notesTypes';
import { NoteCard } from './NoteCard';

interface NotesListProps {
  notes: WebNote[];
  viewMode: NotesViewMode;
  onCardClick: (note: WebNote) => void;
  onToggleDone: (note: WebNote) => void;
  onTogglePin: (note: WebNote) => void;
  onDelete: (note: WebNote) => void;
}

function NoteGroup({
  notes,
  viewMode,
  onCardClick,
  onToggleDone,
  onTogglePin,
  onDelete,
}: NotesListProps) {
  return (
    <div className={`notes-list__group notes-list__group--${viewMode}`}>
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          viewMode={viewMode}
          onClick={() => onCardClick(note)}
          onToggleDone={() => onToggleDone(note)}
          onTogglePin={() => onTogglePin(note)}
          onDelete={() => onDelete(note)}
        />
      ))}
    </div>
  );
}

export function NotesList({
  notes,
  viewMode,
  onCardClick,
  onToggleDone,
  onTogglePin,
  onDelete,
}: NotesListProps) {
  if (notes.length === 0) {
    return (
      <div className="notes-list notes-list--empty">
        <p className="notes-list__empty-text">No notes yet. Create one to get started.</p>
      </div>
    );
  }

  const pinnedNotes = notes.filter((n) => n.isPinned);
  const otherNotes = notes.filter((n) => !n.isPinned);
  const hasBothSections = pinnedNotes.length > 0 && otherNotes.length > 0;
  const groupProps = { viewMode, onCardClick, onToggleDone, onTogglePin, onDelete };

  return (
    <div className="notes-list">
      {pinnedNotes.length > 0 && (
        <section className="notes-list__section">
          <h2 className="notes-list__section-label">
            <Pin size={13} />
            Pinned
          </h2>
          <NoteGroup notes={pinnedNotes} {...groupProps} />
        </section>
      )}
      {hasBothSections && <div className="notes-list__divider" />}
      {otherNotes.length > 0 && (
        <section className="notes-list__section">
          {hasBothSections && <h2 className="notes-list__section-label">Others</h2>}
          <NoteGroup notes={otherNotes} {...groupProps} />
        </section>
      )}
    </div>
  );
}
