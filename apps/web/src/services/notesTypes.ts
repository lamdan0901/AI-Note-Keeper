/**
 * Web-local types for the Notes feature.
 * WebNote mirrors the Convex `notes` document shape, omitting internal Convex fields.
 */

export type NotesViewMode = 'grid' | 'list';
export type RepeatRule = import('../../../../packages/shared/types/reminder').RepeatRule;

/** Preset IDs for note background colours, matching mobile presets. */
export type NoteColorPreset = 'default' | 'red' | 'yellow' | 'green' | 'blue' | 'purple';

/**
 * Mapped representation of a Convex note document as used in the web UI.
 * Omits Convex internals (`_id`, `_creationTime`).
 */
export interface WebNote {
  id: string;
  userId: string;
  title: string | null;
  content: string | null;
  color: string | null;
  active: boolean;
  done: boolean;
  isPinned: boolean;

  // Reminder-related fields (read-only on web; never cleared by web edits)
  triggerAt?: number;
  repeatRule?: 'none' | 'daily' | 'weekly' | 'monthly' | 'custom';
  repeatConfig?: Record<string, unknown> | null;
  repeat?: RepeatRule | null;
  snoozedUntil?: number | null;
  scheduleStatus?: 'scheduled' | 'unscheduled' | 'error';
  timezone?: string | null;
  baseAtLocal?: string | null;
  startAt?: number | null;
  nextTriggerAt?: number | null;
  lastFiredAt?: number | null;
  lastAcknowledgedAt?: number | null;

  version?: number;
  updatedAt: number;
  createdAt: number;
}

/**
 * Local state for the note create/edit modal.
 * `id` is absent when creating a new note (assigned client-side before mutation).
 */
export interface NoteEditorDraft {
  id?: string;
  title: string;
  content: string;
  color: NoteColorPreset;
  isPinned: boolean;
  done: boolean;
  reminder: Date | null;
  repeat: RepeatRule | null;
}
