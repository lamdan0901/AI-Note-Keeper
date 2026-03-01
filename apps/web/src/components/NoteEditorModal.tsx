import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Bell, CheckCircle, Circle, Pin, Trash2, X } from 'lucide-react';
import type { NoteEditorDraft, NoteColorPreset } from '../services/notesTypes';
import { NOTE_COLOR_PRESET_IDS } from '../services/notesUtils';
import { formatReminder } from '../services/reminderUtils';
import { ReminderSetupModal } from './reminders/ReminderSetupModal';

interface NoteEditorModalProps {
  draft: NoteEditorDraft;
  onChange: (draft: NoteEditorDraft) => void;
  onSave: (draftOverride?: NoteEditorDraft) => void;
  onDelete: () => void;
  onClose: () => void;
  isNew: boolean;
}

export function clearReminderInDraft(draft: NoteEditorDraft): NoteEditorDraft {
  return { ...draft, reminder: null, repeat: null };
}

export function toggleDoneInDraft(draft: NoteEditorDraft): NoteEditorDraft {
  const nextDone = !draft.done;
  if (nextDone) {
    return { ...draft, done: true, reminder: null, repeat: null };
  }
  return { ...draft, done: false };
}

export function applyReminderInDraft(
  draft: NoteEditorDraft,
  reminder: Date,
  repeat: NoteEditorDraft['repeat'],
): NoteEditorDraft {
  return { ...draft, reminder, repeat, done: false };
}

const COLOR_LABELS: Record<NoteColorPreset, string> = {
  default: 'Default',
  red: 'Red',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
};

export function NoteEditorModal({
  draft,
  onChange,
  onSave,
  onDelete,
  onClose,
  isNew,
}: NoteEditorModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [reminderOpen, setReminderOpen] = useState(false);

  // Focus title input on open
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (reminderOpen) {
          setReminderOpen(false);
          return;
        }
        onClose();
      }
    },
    [onClose, reminderOpen],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleDeleteClick = () => {
    onDelete();
  };

  const set = <K extends keyof NoteEditorDraft>(key: K, value: NoteEditorDraft[K]) => {
    onChange({ ...draft, [key]: value });
  };

  const reminderLabel = draft.reminder ? formatReminder(draft.reminder, draft.repeat) : null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={isNew ? 'New note' : 'Edit note'}
      onClick={handleBackdropClick}
    >
      <div
        className={`modal-dialog modal-dialog--${draft.color}`}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header row: pin toggle + close */}
        <div className="modal-dialog__header">
          <button
            className={`modal-dialog__pin-btn${draft.isPinned ? ' modal-dialog__pin-btn--active' : ''}`}
            onClick={() => set('isPinned', !draft.isPinned)}
            aria-pressed={draft.isPinned}
            title={draft.isPinned ? 'Unpin note' : 'Pin note'}
            type="button"
          >
            <Pin size={16} />
          </button>

          <button
            className="modal-dialog__close-btn"
            onClick={onClose}
            aria-label="Close editor"
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        {/* Title */}
        <input
          ref={titleRef}
          className="modal-dialog__title-input"
          type="text"
          placeholder="Title"
          value={draft.title}
          onChange={(e) => set('title', e.target.value)}
          aria-label="Note title"
        />

        {/* Content */}
        <textarea
          className="modal-dialog__content-input"
          placeholder="Take a note…"
          value={draft.content}
          onChange={(e) => set('content', e.target.value)}
          rows={6}
          aria-label="Note content"
        />

        {/* Footer: color picker + reminder (same row) | action buttons (bottom right) */}
        <div className="modal-dialog__footer">
          {/* Row 1: color picker (left) + reminder (right) */}
          <div className="modal-dialog__footer-top">
            <div className="modal-dialog__color-picker" role="group" aria-label="Note colour">
              {NOTE_COLOR_PRESET_IDS.map((preset) => (
                <button
                  key={preset}
                  className={`modal-dialog__color-swatch modal-dialog__color-swatch--${preset}${
                    draft.color === preset ? ' modal-dialog__color-swatch--selected' : ''
                  }`}
                  onClick={() => set('color', preset)}
                  aria-pressed={draft.color === preset}
                  aria-label={COLOR_LABELS[preset]}
                  title={COLOR_LABELS[preset]}
                  type="button"
                />
              ))}
            </div>

            <div className="modal-dialog__reminder-area">
              {reminderLabel ? (
                <div className="modal-dialog__reminder-chip-wrap">
                  <button
                    className="modal-dialog__reminder-chip"
                    onClick={() => setReminderOpen(true)}
                    type="button"
                    title={reminderLabel}
                  >
                    <Bell size={14} /> {reminderLabel}
                  </button>
                  <button
                    className="modal-dialog__reminder-clear"
                    onClick={() => {
                      onChange(clearReminderInDraft(draft));
                    }}
                    aria-label="Clear reminder"
                    type="button"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  className="modal-dialog__reminder-trigger"
                  onClick={() => setReminderOpen(true)}
                  type="button"
                >
                  <Bell size={14} /> Reminder
                </button>
              )}
            </div>
          </div>

          {/* Row 2: action buttons (right) */}
          <div className="modal-dialog__footer-actions">
            {/* Done toggle — only in edit mode */}
            {!isNew && (
              <button
                className={`modal-dialog__done-btn${draft.done ? ' modal-dialog__done-btn--active' : ''}`}
                onClick={() => {
                  const toggled = toggleDoneInDraft(draft);
                  onChange(toggled);
                  onSave(toggled);
                }}
                aria-pressed={draft.done}
                title={draft.done ? 'Mark as not done' : 'Mark as done'}
                type="button"
              >
                {draft.done ? (
                  <>
                    <CheckCircle size={16} /> Done
                  </>
                ) : (
                  <>
                    <Circle size={16} /> Done
                  </>
                )}
              </button>
            )}

            {/* Delete — only in edit mode */}
            {!isNew && (
              <button
                className="modal-dialog__delete-btn"
                onClick={handleDeleteClick}
                aria-label="Delete note"
                type="button"
              >
                <Trash2 size={16} /> Delete
              </button>
            )}

            {/* Save */}
            <button
              className="modal-dialog__save-btn"
              onClick={() => onSave()}
              aria-label="Save note"
              type="button"
            >
              Save
            </button>
          </div>
        </div>
      </div>
      {reminderOpen && (
        <ReminderSetupModal
          initialDate={draft.reminder}
          initialRepeat={draft.repeat}
          onClose={() => setReminderOpen(false)}
          onSave={({ reminder, repeat }) => {
            onChange(applyReminderInDraft(draft, reminder, repeat));
            setReminderOpen(false);
          }}
        />
      )}
    </div>
  );
}
