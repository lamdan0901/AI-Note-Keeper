import { describe, expect, it } from 'vitest';
import type { RepeatRule } from '../../../packages/shared/types/reminder';
import {
  buildReminderSyncFields,
  coerceRepeatRule,
  formatReminder,
  getEffectiveTriggerAt,
  getInitialReminderDate,
} from '../src/services/reminderUtils';
import type { WebNote } from '../src/services/notesTypes';

function makeNote(overrides: Partial<WebNote> = {}): WebNote {
  return {
    id: 'note-1',
    userId: 'local-user',
    title: 'Test',
    content: 'Body',
    color: 'default',
    active: true,
    done: false,
    isPinned: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('getEffectiveTriggerAt', () => {
  it('uses snoozedUntil before nextTriggerAt and triggerAt', () => {
    const date = getEffectiveTriggerAt(
      makeNote({ triggerAt: 1_000, nextTriggerAt: 2_000, snoozedUntil: 3_000 }),
    );
    expect(date?.getTime()).toBe(3_000);
  });

  it('uses nextTriggerAt when snoozedUntil is absent', () => {
    const date = getEffectiveTriggerAt(makeNote({ triggerAt: 1_000, nextTriggerAt: 2_000 }));
    expect(date?.getTime()).toBe(2_000);
  });

  it('returns null when no numeric trigger exists', () => {
    expect(getEffectiveTriggerAt(makeNote({}))).toBeNull();
  });
});

describe('coerceRepeatRule', () => {
  it('prefers repeat object when present', () => {
    const repeat: RepeatRule = { kind: 'daily', interval: 3 };
    expect(coerceRepeatRule(makeNote({ repeat, repeatRule: 'weekly' }))).toEqual(repeat);
  });

  it('coerces weekly repeat and falls back weekdays from trigger date when missing', () => {
    const triggerAt = new Date('2026-01-19T10:00:00.000Z').getTime(); // Monday in UTC.
    expect(
      coerceRepeatRule(
        makeNote({
          triggerAt,
          repeatRule: 'weekly',
          repeatConfig: { interval: 2, weekdays: [] },
        }),
      ),
    ).toEqual({ kind: 'weekly', interval: 2, weekdays: [1] });
  });

  it('returns null for repeatRule none', () => {
    expect(coerceRepeatRule(makeNote({ repeatRule: 'none' }))).toBeNull();
  });
});

describe('getInitialReminderDate', () => {
  it('defaults to next hour when no initial date is provided before 22:00', () => {
    const now = new Date(2026, 1, 10, 20, 17, 13, 500);
    const result = getInitialReminderDate(null, now);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(10);
    expect(result.getHours()).toBe(21);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });

  it('moves past initial time to tomorrow 07:00 when now is after 22:00', () => {
    const now = new Date(2026, 1, 10, 22, 15, 0, 0);
    const result = getInitialReminderDate(new Date(2026, 1, 10, 21, 0, 0, 0), now);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(11);
    expect(result.getHours()).toBe(7);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });
});

describe('formatReminder', () => {
  it('appends repeat label when repeat exists', () => {
    const text = formatReminder(new Date('2026-02-10T09:30:00.000Z'), {
      kind: 'daily',
      interval: 1,
    });
    expect(text.endsWith(' · Daily')).toBe(true);
  });

  it('returns date text only when repeat is null', () => {
    const text = formatReminder(new Date('2026-02-10T09:30:00.000Z'), null);
    expect(text.includes('·')).toBe(false);
  });
});

describe('buildReminderSyncFields', () => {
  it('clears reminder fields when reminder is null', () => {
    expect(
      buildReminderSyncFields(
        { reminder: null, repeat: null },
        new Date('2026-02-10T10:00:00.000Z'),
        'UTC',
      ),
    ).toMatchObject({
      triggerAt: undefined,
      repeatRule: 'none',
      repeatConfig: null,
      repeat: null,
      startAt: undefined,
      baseAtLocal: undefined,
      nextTriggerAt: undefined,
      snoozedUntil: undefined,
      scheduleStatus: undefined,
      timezone: 'UTC',
    });
  });

  it('normalizes reminder to future and maps repeat rule/config', () => {
    const now = new Date('2026-02-10T10:20:00.000Z');
    const reminder = new Date('2026-02-10T10:00:30.500Z'); // Past -> next hour.
    const result = buildReminderSyncFields(
      {
        reminder,
        repeat: { kind: 'weekly', interval: 1, weekdays: [1, 3, 5] },
      },
      now,
      'Asia/Bangkok',
    );
    expect(result).toMatchObject({
      triggerAt: new Date('2026-02-10T11:00:00.000Z').getTime(),
      repeatRule: 'weekly',
      repeatConfig: { interval: 1, weekdays: [1, 3, 5] },
      repeat: { kind: 'weekly', interval: 1, weekdays: [1, 3, 5] },
      snoozedUntil: undefined,
      scheduleStatus: 'unscheduled',
      timezone: 'Asia/Bangkok',
    });
  });
});
