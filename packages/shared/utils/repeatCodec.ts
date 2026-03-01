/**
 * repeatCodec.ts
 *
 * Shared codec for repeat rules.  All clients (web, mobile, Convex) should
 * use these helpers so that canonical `repeat` and legacy
 * `repeatRule / repeatConfig` fields are always kept in sync.
 *
 * Precedence when reading:
 *   1. Canonical `repeat` object (has `kind` at top level)
 *   2. Legacy `repeatRule` + `repeatConfig`
 *      – Handles the mobile-shaped config where `repeatConfig` is the spread
 *        of a `RepeatRule` object (i.e. `repeatConfig.kind` exists).
 *      – Handles the web-shaped config where `repeatConfig.frequency` exists.
 */

import { RepeatRule } from '../types/reminder';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeInterval(value: unknown, fallback = 1): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

function normalizeWeekdays(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value.map((e) => Number(e)).filter((e) => Number.isInteger(e) && e >= 0 && e <= 6);
  if (parsed.length === 0) return null;
  return Array.from(new Set(parsed)).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// coerceRepeatRule
// ---------------------------------------------------------------------------

export type CoerceInput = {
  /** Canonical repeat object (preferred). */
  repeat?: RepeatRule | null | unknown;
  /** Legacy string token. */
  repeatRule?: string | null;
  /** Legacy config blob. */
  repeatConfig?: Record<string, unknown> | null | unknown;
  /** Used as fallback for weekly weekday resolution. */
  triggerAt?: number | null;
};

/**
 * Normalise any combination of canonical + legacy fields into a `RepeatRule`
 * or `null` if none or all-default.
 *
 * Handles three config shapes that exist in the wild:
 *   - Canonical:  `repeat: { kind, interval, … }`
 *   - Web legacy: `repeatRule:'custom' + repeatConfig:{ frequency, interval }`
 *   - Mobile legacy: `repeatRule:'custom' + repeatConfig:{ kind, interval, … }`
 *     (mobile spread the RepeatRule object directly into repeatConfig)
 */
export function coerceRepeatRule(input: CoerceInput): RepeatRule | null {
  // 1. Prefer canonical `repeat`
  if (
    isRecord(input.repeat) &&
    typeof (input.repeat as Record<string, unknown>).kind === 'string'
  ) {
    return normalizeRepeatRule(input.repeat as Record<string, unknown>, input.triggerAt);
  }

  const rule = input.repeatRule;
  const config = isRecord(input.repeatConfig)
    ? (input.repeatConfig as Record<string, unknown>)
    : null;

  if (!rule || rule === 'none') return null;

  if (rule === 'daily') {
    const interval = normalizeInterval(config?.interval);
    return { kind: 'daily', interval };
  }

  if (rule === 'weekly') {
    const interval = normalizeInterval(config?.interval);
    const weekdays = normalizeWeekdays(config?.weekdays) ?? [
      new Date(Number(input.triggerAt) || Date.now()).getDay(),
    ];
    return { kind: 'weekly', interval, weekdays };
  }

  if (rule === 'monthly') {
    const interval = normalizeInterval(config?.interval);
    return { kind: 'monthly', interval, mode: 'day_of_month' };
  }

  if (rule === 'custom') {
    // Mobile legacy: config is the spread of a RepeatRule object → has `kind`
    if (config && typeof config.kind === 'string') {
      return normalizeRepeatRule(config, input.triggerAt);
    }

    // Web legacy: config has `frequency`
    const interval = normalizeInterval(config?.interval, 2);
    const frequency =
      config?.frequency === 'minutes' ||
      config?.frequency === 'days' ||
      config?.frequency === 'weeks' ||
      config?.frequency === 'months'
        ? (config.frequency as 'minutes' | 'days' | 'weeks' | 'months')
        : 'days';
    return { kind: 'custom', interval, frequency };
  }

  return null;
}

/**
 * Normalise a raw record already known to have a `kind` field.
 */
function normalizeRepeatRule(
  r: Record<string, unknown>,
  triggerAt?: number | null,
): RepeatRule | null {
  const kind = r.kind as string;
  if (kind === 'daily') {
    return { kind: 'daily', interval: normalizeInterval(r.interval) };
  }
  if (kind === 'weekly') {
    const interval = normalizeInterval(r.interval);
    const weekdays = normalizeWeekdays(r.weekdays) ?? [
      new Date(Number(triggerAt) || Date.now()).getDay(),
    ];
    return { kind: 'weekly', interval, weekdays };
  }
  if (kind === 'monthly') {
    const interval = normalizeInterval(r.interval);
    const mode = r.mode === 'day_of_month' ? 'day_of_month' : 'day_of_month';
    return { kind: 'monthly', interval, mode };
  }
  if (kind === 'custom') {
    const interval = normalizeInterval(r.interval, 2);
    const frequency =
      r.frequency === 'minutes' ||
      r.frequency === 'days' ||
      r.frequency === 'weeks' ||
      r.frequency === 'months'
        ? (r.frequency as 'minutes' | 'days' | 'weeks' | 'months')
        : 'days';
    return { kind: 'custom', interval, frequency };
  }
  return null;
}

// ---------------------------------------------------------------------------
// toLegacyRepeatFields
// ---------------------------------------------------------------------------

export type LegacyRepeatFields = {
  repeatRule: 'none' | 'daily' | 'weekly' | 'monthly' | 'custom';
  repeatConfig: Record<string, unknown> | null;
};

/**
 * Derive legacy `repeatRule` + `repeatConfig` from a canonical `RepeatRule`.
 * Use for dual-write so older clients that only read legacy fields keep working.
 */
export function toLegacyRepeatFields(repeat: RepeatRule | null): LegacyRepeatFields {
  if (!repeat) return { repeatRule: 'none', repeatConfig: null };

  switch (repeat.kind) {
    case 'daily':
      return { repeatRule: 'daily', repeatConfig: { interval: repeat.interval } };
    case 'weekly':
      return {
        repeatRule: 'weekly',
        repeatConfig: { interval: repeat.interval, weekdays: repeat.weekdays },
      };
    case 'monthly':
      return {
        repeatRule: 'monthly',
        repeatConfig: { interval: repeat.interval, mode: repeat.mode },
      };
    case 'custom':
      return {
        repeatRule: 'custom',
        repeatConfig: { interval: repeat.interval, frequency: repeat.frequency },
      };
  }
}

// ---------------------------------------------------------------------------
// buildCanonicalRecurrenceFields
// ---------------------------------------------------------------------------

export type CanonicalRecurrenceFields = {
  repeat: RepeatRule | null;
  startAt: number | null;
  baseAtLocal: string | null;
  nextTriggerAt: number | null;
} & LegacyRepeatFields;

type BuildCanonicalInput = {
  reminderAt: number | null;
  repeat: RepeatRule | null;
  /** Existing note values — used to preserve series anchor when recurrence unchanged. */
  existing?: {
    startAt?: number | null;
    baseAtLocal?: string | null;
    nextTriggerAt?: number | null;
    triggerAt?: number | null;
    repeat?: RepeatRule | null | unknown;
    repeatRule?: string | null;
    repeatConfig?: Record<string, unknown> | null | unknown;
  };
};

/**
 * Build all recurrence fields (canonical + legacy) for a save operation.
 *
 * Anchor (`startAt` / `baseAtLocal`) is preserved when the recurrence
 * definition has not changed; reset when it changes or when set for the
 * first time.
 */
export function buildCanonicalRecurrenceFields(
  input: BuildCanonicalInput,
): CanonicalRecurrenceFields {
  const normalizedRepeat = coerceRepeatRule({ repeat: input.repeat });
  const { reminderAt } = input;
  const legacy = toLegacyRepeatFields(normalizedRepeat);

  if (!reminderAt) {
    return {
      repeat: null,
      startAt: null,
      baseAtLocal: null,
      nextTriggerAt: null,
      ...toLegacyRepeatFields(null),
    };
  }

  // Determine if recurrence definition changed vs existing
  const existingRepeat = input.existing
    ? coerceRepeatRule({
        repeat: input.existing.repeat,
        repeatRule: input.existing.repeatRule,
        repeatConfig: input.existing.repeatConfig,
        triggerAt:
          input.existing.triggerAt ??
          input.existing.nextTriggerAt ??
          input.existing.startAt ??
          reminderAt,
      })
    : null;
  const recurrenceChanged = JSON.stringify(normalizedRepeat) !== JSON.stringify(existingRepeat);

  let startAt: number | null;
  let baseAtLocal: string | null;

  if (!recurrenceChanged && input.existing?.startAt != null) {
    // Preserve anchor
    startAt = input.existing.startAt;
    baseAtLocal = input.existing.baseAtLocal ?? isoLocalFromMs(reminderAt);
  } else {
    // Reset anchor
    startAt = reminderAt;
    baseAtLocal = isoLocalFromMs(reminderAt);
  }

  return {
    repeat: normalizedRepeat,
    startAt,
    baseAtLocal,
    nextTriggerAt: reminderAt,
    ...legacy,
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Format a timestamp as a local ISO string WITHOUT timezone offset suffix,
 * e.g. "2026-03-01T09:00:00".  Used for `baseAtLocal`.
 */
function isoLocalFromMs(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}
