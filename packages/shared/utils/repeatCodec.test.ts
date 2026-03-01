/**
 * repeatCodec.test.ts
 *
 * Unit tests for the shared repeat codec.
 */

import {
  coerceRepeatRule,
  toLegacyRepeatFields,
  buildCanonicalRecurrenceFields,
} from './repeatCodec';

// ---------------------------------------------------------------------------
// coerceRepeatRule
// ---------------------------------------------------------------------------

describe('coerceRepeatRule – canonical repeat', () => {
  it('returns canonical repeat object directly', () => {
    const input = { repeat: { kind: 'daily' as const, interval: 1 } };
    expect(coerceRepeatRule(input)).toEqual({ kind: 'daily', interval: 1 });
  });

  it('returns null for null repeat', () => {
    expect(coerceRepeatRule({ repeat: null })).toBeNull();
  });

  it('normalises interval < 1 to 1', () => {
    expect(coerceRepeatRule({ repeat: { kind: 'daily', interval: 0 } })).toEqual({
      kind: 'daily',
      interval: 1,
    });
  });

  it('normalises weekly weekdays (dedup, sort)', () => {
    const result = coerceRepeatRule({
      repeat: { kind: 'weekly', interval: 1, weekdays: [3, 1, 3] },
    });
    expect(result).toEqual({ kind: 'weekly', interval: 1, weekdays: [1, 3] });
  });
});

describe('coerceRepeatRule – legacy daily/weekly/monthly', () => {
  it('parses legacy daily', () => {
    expect(coerceRepeatRule({ repeatRule: 'daily', repeatConfig: { interval: 2 } })).toEqual({
      kind: 'daily',
      interval: 2,
    });
  });

  it('parses legacy daily with no config', () => {
    expect(coerceRepeatRule({ repeatRule: 'daily' })).toEqual({ kind: 'daily', interval: 1 });
  });

  it('parses legacy weekly', () => {
    expect(
      coerceRepeatRule({ repeatRule: 'weekly', repeatConfig: { interval: 1, weekdays: [1, 3] } }),
    ).toEqual({ kind: 'weekly', interval: 1, weekdays: [1, 3] });
  });

  it('falls back to triggerAt weekday for weekly with no weekdays', () => {
    // Monday = 1 in JS (2026-03-02 is a Monday)
    const triggerAt = new Date('2026-03-02T09:00:00').getTime();
    const result = coerceRepeatRule({ repeatRule: 'weekly', triggerAt });
    expect(result?.kind).toBe('weekly');
    expect(result && result.kind === 'weekly' ? result.weekdays : undefined).toEqual([1]);
  });

  it('parses legacy monthly', () => {
    expect(coerceRepeatRule({ repeatRule: 'monthly', repeatConfig: { interval: 3 } })).toEqual({
      kind: 'monthly',
      interval: 3,
      mode: 'day_of_month',
    });
  });

  it('returns null for none', () => {
    expect(coerceRepeatRule({ repeatRule: 'none' })).toBeNull();
  });
});

describe('coerceRepeatRule – mobile legacy shape (repeatConfig.kind)', () => {
  it('parses mobile legacy daily via repeatConfig.kind', () => {
    expect(
      coerceRepeatRule({
        repeatRule: 'custom',
        repeatConfig: { kind: 'daily', interval: 1 },
      }),
    ).toEqual({ kind: 'daily', interval: 1 });
  });

  it('parses mobile legacy weekly via repeatConfig.kind', () => {
    expect(
      coerceRepeatRule({
        repeatRule: 'custom',
        repeatConfig: { kind: 'weekly', interval: 1, weekdays: [1, 3] },
      }),
    ).toEqual({ kind: 'weekly', interval: 1, weekdays: [1, 3] });
  });

  it('parses mobile legacy monthly via repeatConfig.kind', () => {
    expect(
      coerceRepeatRule({
        repeatRule: 'custom',
        repeatConfig: { kind: 'monthly', interval: 2 },
      }),
    ).toEqual({ kind: 'monthly', interval: 2, mode: 'day_of_month' });
  });

  it('parses web legacy custom via repeatConfig.frequency', () => {
    expect(
      coerceRepeatRule({
        repeatRule: 'custom',
        repeatConfig: { interval: 30, frequency: 'minutes' },
      }),
    ).toEqual({ kind: 'custom', interval: 30, frequency: 'minutes' });
  });
});

describe('coerceRepeatRule – canonical takes precedence over legacy', () => {
  it('uses canonical repeat even when legacy fields also present', () => {
    expect(
      coerceRepeatRule({
        repeat: { kind: 'monthly', interval: 1, mode: 'day_of_month' },
        repeatRule: 'daily',
        repeatConfig: { interval: 7 },
      }),
    ).toEqual({ kind: 'monthly', interval: 1, mode: 'day_of_month' });
  });
});

// ---------------------------------------------------------------------------
// toLegacyRepeatFields
// ---------------------------------------------------------------------------

describe('toLegacyRepeatFields', () => {
  it('returns none for null', () => {
    expect(toLegacyRepeatFields(null)).toEqual({ repeatRule: 'none', repeatConfig: null });
  });

  it('maps daily correctly', () => {
    expect(toLegacyRepeatFields({ kind: 'daily', interval: 2 })).toEqual({
      repeatRule: 'daily',
      repeatConfig: { interval: 2 },
    });
  });

  it('maps weekly correctly', () => {
    expect(toLegacyRepeatFields({ kind: 'weekly', interval: 1, weekdays: [1, 3] })).toEqual({
      repeatRule: 'weekly',
      repeatConfig: { interval: 1, weekdays: [1, 3] },
    });
  });

  it('maps monthly correctly', () => {
    expect(tolLegacyRepeatFields({ kind: 'monthly', interval: 1, mode: 'day_of_month' })).toEqual({
      repeatRule: 'monthly',
      repeatConfig: { interval: 1, mode: 'day_of_month' },
    });
  });

  it('maps custom correctly', () => {
    expect(toLegacyRepeatFields({ kind: 'custom', interval: 30, frequency: 'minutes' })).toEqual({
      repeatRule: 'custom',
      repeatConfig: { interval: 30, frequency: 'minutes' },
    });
  });
});

// Alias for the typo above to make the test fail gracefully
const tolLegacyRepeatFields = toLegacyRepeatFields;

// ---------------------------------------------------------------------------
// buildCanonicalRecurrenceFields
// ---------------------------------------------------------------------------

describe('buildCanonicalRecurrenceFields', () => {
  const triggerMs = new Date('2026-03-02T09:00:00').getTime();

  it('returns all null when no reminder', () => {
    const result = buildCanonicalRecurrenceFields({ reminderAt: null, repeat: null });
    expect(result.repeat).toBeNull();
    expect(result.startAt).toBeNull();
    expect(result.baseAtLocal).toBeNull();
    expect(result.nextTriggerAt).toBeNull();
    expect(result.repeatRule).toBe('none');
  });

  it('sets anchor on first creation', () => {
    const result = buildCanonicalRecurrenceFields({
      reminderAt: triggerMs,
      repeat: { kind: 'daily', interval: 1 },
    });
    expect(result.startAt).toBe(triggerMs);
    expect(result.nextTriggerAt).toBe(triggerMs);
    expect(result.repeat).toEqual({ kind: 'daily', interval: 1 });
    expect(result.repeatRule).toBe('daily');
  });

  it('preserves anchor when recurrence unchanged', () => {
    const originalStart = triggerMs - 7 * 24 * 60 * 60 * 1000; // 1 week ago
    const result = buildCanonicalRecurrenceFields({
      reminderAt: triggerMs,
      repeat: { kind: 'daily', interval: 1 },
      existing: {
        startAt: originalStart,
        baseAtLocal: '2026-02-23T09:00:00',
        repeat: { kind: 'daily', interval: 1 },
      },
    });
    expect(result.startAt).toBe(originalStart);
    expect(result.baseAtLocal).toBe('2026-02-23T09:00:00');
  });

  it('preserves anchor when existing recurrence is legacy-only but equivalent', () => {
    const originalStart = triggerMs - 7 * 24 * 60 * 60 * 1000;
    const result = buildCanonicalRecurrenceFields({
      reminderAt: triggerMs,
      repeat: { kind: 'daily', interval: 1 },
      existing: {
        startAt: originalStart,
        baseAtLocal: '2026-02-23T09:00:00',
        repeat: undefined,
        repeatRule: 'daily',
        repeatConfig: { interval: 1 },
        triggerAt: originalStart,
      },
    });
    expect(result.startAt).toBe(originalStart);
    expect(result.baseAtLocal).toBe('2026-02-23T09:00:00');
  });

  it('resets anchor when recurrence changes', () => {
    const originalStart = triggerMs - 7 * 24 * 60 * 60 * 1000;
    const result = buildCanonicalRecurrenceFields({
      reminderAt: triggerMs,
      repeat: { kind: 'weekly', interval: 1, weekdays: [1] },
      existing: {
        startAt: originalStart,
        baseAtLocal: '2026-02-23T09:00:00',
        repeat: { kind: 'daily', interval: 1 },
      },
    });
    expect(result.startAt).toBe(triggerMs);
    expect(result.repeatRule).toBe('weekly');
  });
});
