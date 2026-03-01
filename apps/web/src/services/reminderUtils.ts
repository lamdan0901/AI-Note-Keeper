import type { RepeatRule } from '../../../../packages/shared/types/reminder';
import type { NoteEditorDraft, WebNote } from './notesTypes';

type LegacyRepeatRule = 'none' | 'daily' | 'weekly' | 'monthly' | 'custom';

type ReminderSyncFields = {
  triggerAt?: number;
  repeatRule?: LegacyRepeatRule;
  repeatConfig?: Record<string, unknown> | null;
  snoozedUntil?: number;
  scheduleStatus?: 'scheduled' | 'unscheduled' | 'error';
  timezone?: string;
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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

function normalizeWeekdays(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 6);
  if (parsed.length === 0) return null;
  return Array.from(new Set(parsed)).sort((a, b) => a - b);
}

export function getEffectiveTriggerAt(note: WebNote): Date | null {
  const value = note.snoozedUntil ?? note.nextTriggerAt ?? note.triggerAt;
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return new Date(value);
}

export function coerceRepeatRule(note: WebNote): RepeatRule | null {
  if (note.repeat && typeof note.repeat === 'object' && 'kind' in note.repeat) {
    return note.repeat as RepeatRule;
  }

  const rule = note.repeatRule;
  const config = note.repeatConfig;

  if (!rule || rule === 'none') return null;
  if (rule === 'daily') {
    const interval = isRecord(config) && typeof config.interval === 'number' ? config.interval : 1;
    return { kind: 'daily', interval: Math.max(1, interval) };
  }
  if (rule === 'weekly') {
    const interval = isRecord(config) && typeof config.interval === 'number' ? config.interval : 1;
    const weekdays = normalizeWeekdays(isRecord(config) ? config.weekdays : undefined) ?? [
      new Date(note.triggerAt ?? Date.now()).getDay(),
    ];
    return { kind: 'weekly', interval: Math.max(1, interval), weekdays };
  }
  if (rule === 'monthly') {
    const interval = isRecord(config) && typeof config.interval === 'number' ? config.interval : 1;
    return { kind: 'monthly', interval: Math.max(1, interval), mode: 'day_of_month' };
  }
  if (rule === 'custom') {
    const interval = isRecord(config) && typeof config.interval === 'number' ? config.interval : 2;
    const frequency =
      isRecord(config) &&
      (config.frequency === 'minutes' ||
        config.frequency === 'days' ||
        config.frequency === 'weeks' ||
        config.frequency === 'months')
        ? config.frequency
        : 'days';
    return { kind: 'custom', interval: Math.max(1, interval), frequency };
  }

  return null;
}

function formatRepeatLabel(repeat: RepeatRule | null): string | null {
  if (!repeat) return null;
  if (repeat.kind === 'daily') {
    return repeat.interval === 1 ? 'Daily' : `Every ${repeat.interval} days`;
  }
  if (repeat.kind === 'weekly') {
    const days = repeat.weekdays.map((day) => WEEKDAY_LABELS[day]).join(', ');
    if (repeat.interval === 1) return `Weekly (${days})`;
    return `Every ${repeat.interval} weeks (${days})`;
  }
  if (repeat.kind === 'monthly') {
    return repeat.interval === 1 ? 'Monthly' : `Every ${repeat.interval} months`;
  }
  if (repeat.frequency === 'days') {
    return `Every ${repeat.interval} days`;
  }
  if (repeat.frequency === 'weeks') {
    return `Every ${repeat.interval} weeks`;
  }
  if (repeat.frequency === 'months') {
    return `Every ${repeat.interval} months`;
  }
  return `Every ${repeat.interval} minutes`;
}

export function formatReminder(date: Date, repeat: RepeatRule | null): string {
  const dateText = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  const repeatText = formatRepeatLabel(repeat);
  return repeatText ? `${dateText} · ${repeatText}` : dateText;
}

export function getInitialReminderDate(initialDate: Date | null, now: Date): Date {
  if (!initialDate) {
    return normalizeToFutureDate(now, now);
  }
  return normalizeToFutureDate(initialDate, now);
}

function toLegacyRepeatFields(repeat: RepeatRule | null): {
  repeatRule: LegacyRepeatRule;
  repeatConfig: Record<string, unknown> | null;
} {
  if (!repeat) {
    return { repeatRule: 'none', repeatConfig: null };
  }

  if (repeat.kind === 'daily') {
    return {
      repeatRule: 'daily',
      repeatConfig: { interval: repeat.interval },
    };
  }

  if (repeat.kind === 'weekly') {
    return {
      repeatRule: 'weekly',
      repeatConfig: { interval: repeat.interval, weekdays: repeat.weekdays },
    };
  }

  if (repeat.kind === 'monthly') {
    return {
      repeatRule: 'monthly',
      repeatConfig: { interval: repeat.interval, mode: repeat.mode },
    };
  }

  return {
    repeatRule: 'custom',
    repeatConfig: { interval: repeat.interval, frequency: repeat.frequency },
  };
}

export function buildReminderSyncFields(
  draft: Pick<NoteEditorDraft, 'reminder' | 'repeat'>,
  now: Date,
  timezone: string,
): ReminderSyncFields {
  if (!draft.reminder) {
    return {
      triggerAt: undefined,
      repeatRule: 'none',
      repeatConfig: null,
      snoozedUntil: undefined,
      scheduleStatus: undefined,
      timezone,
    };
  }

  const normalizedReminder = normalizeToFutureDate(draft.reminder, now);
  const repeatFields = toLegacyRepeatFields(draft.repeat);

  return {
    triggerAt: normalizedReminder.getTime(),
    ...repeatFields,
    snoozedUntil: undefined,
    scheduleStatus: 'unscheduled',
    timezone,
  };
}
