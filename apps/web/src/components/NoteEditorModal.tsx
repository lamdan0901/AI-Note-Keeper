import React, { useEffect, useRef, useCallback, useState } from 'react';
import { CheckCircle, Circle, List, Pin, Trash2, Type, X } from 'lucide-react';
import type { NoteEditorDraft, NoteColorPreset } from '../services/notesTypes';
import { NOTE_COLOR_PRESET_IDS } from '../services/notesUtils';
import { ReminderSetupPanel } from './reminders/ReminderSetupPanel';
import { ChecklistEditor } from './ChecklistEditor';
import type { ChecklistItem } from '../../../../packages/shared/types/note';
import {
  parseChecklist,
  serializeChecklist,
  newChecklistItem,
  textToChecklist,
  checklistToText,
} from '../../../../packages/shared/utils/checklist';

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

export function isReminderBlockingSave(reminder: Date | null, now: Date): boolean {
  return reminder !== null && reminder.getTime() <= now.getTime();
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
  const mouseDownInsideDialog = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  // Checklist state
  const isChecklist = draft.contentType === 'checklist';
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>(() =>
    isChecklist ? parseChecklist(draft.content) : [],
  );

  const isBothEmpty =
    !draft.title.trim() &&
    (isChecklist
      ? checklistItems.every((item) => !item.text.trim())
      : !draft.content.trim());

  const reminderBlocksSave = isReminderBlockingSave(draft.reminder, new Date());

  // Sync checklist items back to draft.content
  const handleChecklistChange = (items: ChecklistItem[]) => {
    setChecklistItems(items);
    onChange({ ...draft, content: serializeChecklist(items) });
  };

  const handleToggleContentType = () => {
    if (isChecklist) {
      // Switch to text
      const text = checklistToText(checklistItems);
      onChange({ ...draft, contentType: 'text', content: text });
    } else {
      // Switch to checklist
      const items = draft.content ? textToChecklist(draft.content) : [newChecklistItem()];
      setChecklistItems(items);
      onChange({ ...draft, contentType: 'checklist', content: serializeChecklist(items) });
    }
  };

  // Focus title input on open
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Grow description height with content up to ~3 lines, then scroll
  useEffect(() => {
    if (isChecklist) return;
    const el = contentRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxPx = parseFloat(getComputedStyle(el).maxHeight);
    const next = Number.isFinite(maxPx) ? Math.min(el.scrollHeight, maxPx) : el.scrollHeight;
    el.style.height = `${next}px`;
  }, [draft.content, isChecklist]);

  // Close on Escape, save on Ctrl+Enter
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && e.ctrlKey) {
        if (!isBothEmpty && !isReminderBlockingSave(draft.reminder, new Date())) {
          e.preventDefault();
          onSave();
        }
      }
    },
    [onClose, onSave, isBothEmpty, draft.reminder],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Close on backdrop click — but not when the drag started inside the dialog
  const handleOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    mouseDownInsideDialog.current = dialogRef.current?.contains(e.target as Node) ?? false;
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !mouseDownInsideDialog.current) {
      onClose();
    }
  };

  const handleDeleteClick = () => {
    onDelete();
  };

  const set = <K extends keyof NoteEditorDraft>(key: K, value: NoteEditorDraft[K]) => {
    onChange({ ...draft, [key]: value });
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={isNew ? 'New note' : 'Edit note'}
      onMouseDown={handleOverlayMouseDown}
      onClick={handleBackdropClick}
    >
      <div
        className={`modal-dialog modal-dialog--note-editor modal-dialog--${draft.color}`}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: pin | color picker | close */}
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

          <button
            className="modal-dialog__close-btn"
            onClick={onClose}
            aria-label="Close editor"
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-dialog__scroll">
          {/* Note body section (title + content) */}
          <div className="modal-dialog__note-section">
            <input
              ref={titleRef}
              className="modal-dialog__title-input"
              type="text"
              placeholder="Title"
              value={draft.title}
              onChange={(e) => set('title', e.target.value)}
              aria-label="Note title"
            />

            <div className="modal-dialog__content-area">
              {isChecklist ? (
                <ChecklistEditor items={checklistItems} onChange={handleChecklistChange} />
              ) : (
                <textarea
                  ref={contentRef}
                  className="modal-dialog__content-input"
                  placeholder="Take a note…"
                  value={draft.content}
                  onChange={(e) => set('content', e.target.value)}
                  rows={1}
                  aria-label="Note content"
                />
              )}
            </div>
          </div>

          <ReminderSetupPanel
            reminder={draft.reminder}
            repeat={draft.repeat}
            noteColor={draft.color}
            onChange={({ reminder, repeat }) => {
              if (reminder === null) {
                onChange(clearReminderInDraft(draft));
                return;
              }
              onChange(applyReminderInDraft(draft, reminder, repeat));
            }}
          />
        </div>

        {/* Sticky footer: secondary actions left-ish, Save primary right */}
        <div className="modal-dialog__footer">
          <div className="modal-dialog__footer-actions">
            <div className="modal-dialog__footer-secondary">
              <button
                className="modal-dialog__content-type-btn"
                onClick={handleToggleContentType}
                title={isChecklist ? 'Switch to plain text' : 'Switch to checklist'}
                type="button"
              >
                {isChecklist ? <Type size={16} /> : <List size={16} />}
                {isChecklist ? 'Text' : 'Checklist'}
              </button>

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
            </div>

            <button
              className="modal-dialog__save-btn"
              onClick={() => onSave()}
              disabled={isBothEmpty || reminderBlocksSave}
              aria-label="Save note"
              type="button"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
