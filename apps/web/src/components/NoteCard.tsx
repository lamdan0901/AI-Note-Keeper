import React from 'react';
import { Bell, Check, Pin, Trash2 } from 'lucide-react';
import type { WebNote } from '../services/notesTypes';
import type { NotesViewMode } from '../services/notesTypes';
import { toPresetId } from '../services/notesUtils';
import { coerceRepeatRule, formatReminder, getEffectiveTriggerAt } from '../services/reminderUtils';

interface NoteCardProps {
  note: WebNote;
  viewMode: NotesViewMode;
  onClick: () => void;
  onToggleDone: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}

export function NoteCard({ note, viewMode, onClick, onToggleDone, onTogglePin, onDelete }: NoteCardProps) {
  const colorPreset = toPresetId(note.color);
  const ariaLabel = note.title && note.title.trim().length > 0 ? note.title : 'Untitled note';
  const reminderAt = getEffectiveTriggerAt(note);
  const reminderLabel = reminderAt ? formatReminder(reminderAt, coerceRepeatRule(note)) : null;

  return (
    <article
      className={`note-card note-card--${viewMode} note-card--${colorPreset}${note.done ? ' note-card--done' : ''}`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
    >
      <button
        className={`note-card__icon-btn note-card__pin-btn${
          note.isPinned ? ' note-card__pin-btn--visible note-card__icon-btn--active' : ''
        }`}
        onClick={(event) => {
          event.stopPropagation();
          event.currentTarget.blur();
          onTogglePin();
        }}
        aria-pressed={note.isPinned}
        aria-label={note.isPinned ? 'Unpin note' : 'Pin note'}
        title={note.isPinned ? 'Unpin note' : 'Pin note'}
        type="button"
      >
        <Pin size={16} />
      </button>

      <div className="note-card__actions note-card__actions--left">
        <button
          className={`note-card__icon-btn${note.done ? ' note-card__icon-btn--active' : ''}`}
          onClick={(event) => {
            event.stopPropagation();
            event.currentTarget.blur();
            onToggleDone();
          }}
          aria-pressed={note.done}
          aria-label={note.done ? 'Mark as not done' : 'Mark as done'}
          title={note.done ? 'Mark as not done' : 'Mark as done'}
          type="button"
        >
          <Check size={16} />
        </button>
        <button
          className="note-card__icon-btn note-card__icon-btn--danger"
          onClick={(event) => {
            event.stopPropagation();
            event.currentTarget.blur();
            onDelete();
          }}
          aria-label="Delete note"
          title="Delete note"
          type="button"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="note-card__body">
        {note.title && <p className="note-card__title">{note.title}</p>}

        {note.content && <p className="note-card__content">{note.content}</p>}

        {!note.title && !note.content && <p className="note-card__empty">Empty note</p>}
      </div>

      {reminderLabel ? (
        <div className="note-card__reminder" aria-label={`Reminder ${reminderLabel}`}>
          <span className="note-card__reminder-icon" aria-hidden="true">
            <Bell size={14} />
          </span>
          <span className="note-card__reminder-text">{reminderLabel}</span>
        </div>
      ) : null}
    </article>
  );
}
