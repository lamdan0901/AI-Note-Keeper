import type { RepeatRule } from '../../../../packages/shared/types/reminder';
import {
  coerceRepeatRule as sharedCoerceRepeatRule,
  buildCanonicalRecurrenceFields,
} from '../../../../packages/shared/utils/repeatCodec';
import { formatReminderLabel } from '../../../../packages/shared/utils/repeatLabel';
import type { NoteEditorDraft, WebNote } from './notesTypes';

type ReminderSyncFields = {
  triggerAt?: number;
  repeatRule?: 'none' | 'daily' | 'weekly' | 'monthly' | 'custom';
  repeatConfig?: Record<string, unknown> | null;
  repeat?: RepeatRule | null;
  startAt?: number | null;
  baseAtLocal?: string | null;
  nextTriggerAt?: number | null;
  snoozedUntil?: number;
  scheduleStatus?: 'scheduled' | 'unscheduled' | 'error';
  timezone?: string;
};

function normalizeToFutureDate(date: Date, now: Date): Date {
  const normalized = new Date(date);
  normalized.setSeconds(0, 0);

  if (normalized.getTime() > now.getTime()) {
    return normalized;
  }

  if (now.getHours() >= 22) {
    const tomorrowMorning = new Date(now);
    tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
    tomorrowMorning.setHours(7, 0, 0, 0);
    return tomorrowMorning;
  }

  const nextHour = new Date(now);
  nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
  return nextHour;
}

export function getEffectiveTriggerAt(note: WebNote): Date | null {
  const value = note.snoozedUntil ?? note.nextTriggerAt ?? note.triggerAt;
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return new Date(value);
}

/**
 * Resolve a `RepeatRule` from a `WebNote`, handling all known legacy shapes.
 * Delegates to the shared codec which supports:
 *   - Canonical `repeat` object
 *   - Legacy `repeatRule:'daily'|'weekly'|'monthly'`
 *   - Legacy `repeatRule:'custom' + repeatConfig.frequency` (web shape)
 *   - Mobile legacy `repeatRule:'custom' + repeatConfig.kind` (spread shape)
 */
export function coerceRepeatRule(note: WebNote): RepeatRule | null {
  return sharedCoerceRepeatRule({
    repeat: note.repeat,
    repeatRule: note.repeatRule,
    repeatConfig: note.repeatConfig,
    triggerAt: note.triggerAt,
  });
}

export function formatReminder(date: Date, repeat: RepeatRule | null): string {
  return formatReminderLabel(date, repeat);
}

export function getInitialReminderDate(initialDate: Date | null, now: Date): Date {
  if (!initialDate) {
    return normalizeToFutureDate(now, now);
  }
  return normalizeToFutureDate(initialDate, now);
}

export function buildReminderSyncFields(
  draft: Pick<NoteEditorDraft, 'reminder' | 'repeat'>,
  now: Date,
  timezone: string,
  existingNote?: WebNote | null,
): ReminderSyncFields {
  if (!draft.reminder) {
    return {
      triggerAt: undefined,
      repeatRule: 'none' as const,
      repeatConfig: null,
      repeat: null,
      startAt: null,
      baseAtLocal: null,
      nextTriggerAt: null,
      snoozedUntil: undefined,
      scheduleStatus: undefined,
      timezone,
    };
  }

  const normalizedReminder = normalizeToFutureDate(draft.reminder, now);

  const canonical = buildCanonicalRecurrenceFields({
    reminderAt: normalizedReminder.getTime(),
    repeat: draft.repeat,
    existing: existingNote ?? undefined,
  });

  return {
    triggerAt: normalizedReminder.getTime(),
    repeatRule: canonical.repeatRule as ReminderSyncFields['repeatRule'],
    repeatConfig: canonical.repeatConfig,
    repeat: canonical.repeat,
    startAt: canonical.startAt ?? undefined,
    baseAtLocal: canonical.baseAtLocal ?? undefined,
    nextTriggerAt: canonical.nextTriggerAt ?? undefined,
    snoozedUntil: undefined,
    scheduleStatus: 'unscheduled',
    timezone,
  };
}
