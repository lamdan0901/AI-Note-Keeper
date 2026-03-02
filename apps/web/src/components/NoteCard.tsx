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
  const title = note.title?.trim() ?? '';
  const content = note.content?.trim() ?? '';
  const ariaLabel = title.length > 0 ? title : 'Untitled note';
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
      <div className="note-card__actions">
        <button
          className={`note-card__icon-btn${note.isPinned ? ' note-card__icon-btn--active' : ''}`}
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
        {title ? <p className="note-card__title">{title}</p> : null}

        {content ? <p className="note-card__content">{content}</p> : null}

        {!title && !content ? <p className="note-card__empty">Empty note</p> : null}
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
