import { computeNextTrigger } from './recurrence';
import { RepeatRule } from '../types/reminder';

describe('computeNextTrigger', () => {
  // Helpers — all dates treated as UTC for consistent cross-timezone test results
  const makeDate = (iso: string) => {
    // Ensure UTC interpretation
    const normalized = iso.endsWith('Z') ? iso : iso + 'Z';
    return new Date(normalized).getTime();
  };
  const baseIso = '2026-02-01T09:00:00'; // 9:00 AM local time string for time extraction
  const tz = 'UTC'; // Explicit timezone for all tests

  test('Non-repeating future', () => {
    const now = makeDate('2026-01-01T10:00:00');
    const startAt = makeDate('2026-02-01T09:00:00');

    // Should result in startAt
    expect(computeNextTrigger(now, startAt, baseIso, null, tz)).toBe(startAt);
  });

  test('Non-repeating past returns null', () => {
    const now = makeDate('2026-03-01T10:00:00');
    const startAt = makeDate('2026-02-01T09:00:00');

    expect(computeNextTrigger(now, startAt, baseIso, null, tz)).toBeNull();
  });

  test('StartAt equals Now (Strictly future trigger needed)', () => {
    const dailyRule: RepeatRule = { kind: 'daily', interval: 1 };
    const dateStr = '2026-02-01T09:00:00';
    const now = makeDate(dateStr);
    const startAt = makeDate(dateStr);

    // Should skip "now" and go to next interval
    const expected = makeDate('2026-02-02T09:00:00');
    expect(computeNextTrigger(now, startAt, dateStr, dailyRule, tz)).toBe(expected);
  });

  describe('Daily', () => {
    const dailyRule: RepeatRule = { kind: 'daily', interval: 1 };

    test('Next day', () => {
      const startAt = makeDate('2026-01-01T09:00:00'); // Thursday
      const now = makeDate('2026-01-01T10:00:00'); // 1 hour after start

      // Should be Jan 2, 9:00
      const expected = makeDate('2026-01-02T09:00:00');
      expect(computeNextTrigger(now, startAt, baseIso, dailyRule, tz)).toBe(expected);
    });

    test('Skip multiple days', () => {
      const startAt = makeDate('2026-01-01T09:00:00');
      const now = makeDate('2026-01-05T08:00:00'); // Before trigger on Jan 5

      // Should be Jan 5, 9:00 (since 8am < 9am)
      const expected = makeDate('2026-01-05T09:00:00');
      expect(computeNextTrigger(now, startAt, baseIso, dailyRule, tz)).toBe(expected);
    });

    test('Skip multiple days (after time)', () => {
      const startAt = makeDate('2026-01-01T09:00:00');
      const now = makeDate('2026-01-05T10:00:00'); // After trigger on Jan 5

      // Should be Jan 6, 9:00
      const expected = makeDate('2026-01-06T09:00:00');
      expect(computeNextTrigger(now, startAt, baseIso, dailyRule, tz)).toBe(expected);
    });

    test('Daily Interval 3', () => {
      const rule: RepeatRule = { kind: 'daily', interval: 3 };
      const startAt = makeDate('2026-01-01T09:00:00'); // Jan 1
      const now = makeDate('2026-01-02T10:00:00'); // Jan 2

      // Seq: Jan 1, Jan 4, Jan 7...
      // Next after Jan 2 is Jan 4
      const expected = makeDate('2026-01-04T09:00:00');
      expect(computeNextTrigger(now, startAt, baseIso, rule, tz)).toBe(expected);
    });
  });

  describe('Weekly', () => {
    // Jan 1 2026 is Thursday
    const startAt = makeDate('2026-01-01T09:00:00'); // Thursday

    test('Same week later day', () => {
      // Repeat Th(4), Fr(5)
      const rule: RepeatRule = { kind: 'weekly', interval: 1, weekdays: [4, 5] };
      const now = makeDate('2026-01-01T10:00:00'); // Th 10am

      // Next is Fri Jan 2
      const expected = makeDate('2026-01-02T09:00:00');
      expect(computeNextTrigger(now, startAt, baseIso, rule, tz)).toBe(expected);
    });

    test('Next week', () => {
      // Repeat Th(4)
      const rule: RepeatRule = { kind: 'weekly', interval: 1, weekdays: [4] };
      const now = makeDate('2026-01-01T10:00:00'); // Th 10am

      // Next is Th Jan 8
      const expected = makeDate('2026-01-08T09:00:00');
      expect(computeNextTrigger(now, startAt, baseIso, rule, tz)).toBe(expected);
    });

    test('Bi-weekly (Interval 2)', () => {
      // Repeat Th(4) every 2 weeks
      const rule: RepeatRule = { kind: 'weekly', interval: 2, weekdays: [4] };
      const now = makeDate('2026-01-02T10:00:00'); // Fri Jan 2, 10am

      // Block 1: Week of Jan 1 (Triggered Jan 1)
      // Block 2: Week of Jan 15 (inherent logic: week starts + 14 days)
      // Note: Logic aligns to strict week boundaries relative to startAt

      // Jan 1 is Th.
      // Start Week Sun: Dec 28 2025.
      // Next Week Block (+2 weeks): Jan 11 2026 (Sun).
      // Target weekday 4 (Th) in that week: Jan 15.

      const expected = makeDate('2026-01-15T09:00:00');
      expect(computeNextTrigger(now, startAt, baseIso, rule, tz)).toBe(expected);
    });

    test('Empty weekdays returns null', () => {
      const rule: RepeatRule = { kind: 'weekly', interval: 1, weekdays: [] };
      const now = makeDate('2026-01-02T10:00:00');
      expect(computeNextTrigger(now, startAt, baseIso, rule, tz)).toBeNull();
    });
  });

  describe('Monthly', () => {
    const mode = 'day_of_month';

    test('Simple Monthly', () => {
      // 15th of month
      const startAt = makeDate('2026-01-15T09:00:00');
      const rule: RepeatRule = { kind: 'monthly', interval: 1, mode };
      const base = '2026-01-15T09:00:00';

      const now = makeDate('2026-01-20T00:00:00');

      // Next: Feb 15
      const expected = makeDate('2026-02-15T09:00:00');
      expect(computeNextTrigger(now, startAt, base, rule, tz)).toBe(expected);
    });

    test('End of month clamping (31st)', () => {
      // 31st of Jan
      const startAt = makeDate('2026-01-31T09:00:00');
      const rule: RepeatRule = { kind: 'monthly', interval: 1, mode };
      const base = '2026-01-31T09:00:00';

      const now = makeDate('2026-02-01T00:00:00');

      // Next: Feb 28 (2026 not leap)
      const expected = makeDate('2026-02-28T09:00:00');
      expect(computeNextTrigger(now, startAt, base, rule, tz)).toBe(expected);
    });

    test('Original day persists after clamping (Jan 31 -> Feb 28 -> Mar 31)', () => {
      // Start: Jan 31
      const startAt = makeDate('2026-01-31T09:00:00');
      const rule: RepeatRule = { kind: 'monthly', interval: 1, mode };
      const base = '2026-01-31T09:00:00';

      // Fake "Now" as Feb 28th PM (after the Feb trigger)
      const now = makeDate('2026-02-28T10:00:00');

      // Feb trigger would have been Feb 28. Since now is after that,
      // we expect the March trigger.
      // It SHOULD recover to Mar 31, NOT stay at 28.
      const expected = makeDate('2026-03-31T09:00:00');
      expect(computeNextTrigger(now, startAt, base, rule, tz)).toBe(expected);
    });

    test('Leap Year (Jan 31 2028 -> Feb 29 2028)', () => {
      // 2028 is leap year
      const startAt = makeDate('2028-01-31T09:00:00');
      const rule: RepeatRule = { kind: 'monthly', interval: 1, mode };
      const base = '2028-01-31T09:00:00';

      const now = makeDate('2028-02-01T00:00:00');

      // Next: Feb 29
      const expected = makeDate('2028-02-29T09:00:00');
      expect(computeNextTrigger(now, startAt, base, rule, tz)).toBe(expected);
    });

    test('Leap Year to Non-Leap (Feb 29 2028 -> Feb 28 2029)', () => {
      // Start on Leap Day
      const startAt = makeDate('2028-02-29T09:00:00');
      const rule: RepeatRule = { kind: 'monthly', interval: 12, mode }; // Yearly via interval
      const base = '2028-02-29T09:00:00';

      const now = makeDate('2028-03-01T00:00:00');

      // Next year 2029 is not leap. Feb should be 28.
      const expected = makeDate('2029-02-28T09:00:00');
      expect(computeNextTrigger(now, startAt, base, rule, tz)).toBe(expected);
    });

    test('Quarterly (Interval 3)', () => {
      const startAt = makeDate('2026-01-01T09:00:00');
      const rule: RepeatRule = { kind: 'monthly', interval: 3, mode };
      const base = '2026-01-01T09:00:00';

      const now = makeDate('2026-02-01T00:00:00');

      // Next: Apr 1 (Jan + 3 months)
      const expected = makeDate('2026-04-01T09:00:00');
      expect(computeNextTrigger(now, startAt, base, rule, tz)).toBe(expected);
    });
  });

  describe('Custom', () => {
    test('Custom Minutes (Every 3 minutes)', () => {
      const startAt = makeDate('2026-01-01T09:00:00');
      const rule: RepeatRule = { kind: 'custom', frequency: 'minutes', interval: 3 };
      const base = '2026-01-01T09:00:00';

      const now = makeDate('2026-01-01T09:02:00');

      const expected = makeDate('2026-01-01T09:03:00');
      expect(computeNextTrigger(now, startAt, base, rule, tz)).toBe(expected);
    });

    test('Custom Days (Every 5 days)', () => {
      const startAt = makeDate('2026-01-01T09:00:00');
      const rule: RepeatRule = { kind: 'custom', frequency: 'days', interval: 5 };
      const base = '2026-01-01T09:00:00';

      const now = makeDate('2026-01-02T00:00:00');

      // Jan 1 + 5 days = Jan 6
      const expected = makeDate('2026-01-06T09:00:00');
      expect(computeNextTrigger(now, startAt, base, rule, tz)).toBe(expected);
    });

    test('Custom Weeks (Every 2 weeks), implicitly starts on same weekday', () => {
      const startAt = makeDate('2026-01-01T09:00:00'); // Thursday
      const rule: RepeatRule = { kind: 'custom', frequency: 'weeks', interval: 2 };
      const base = '2026-01-01T09:00:00';

      const now = makeDate('2026-01-02T00:00:00');

      // Jan 1 + 14 days = Jan 15
      const expected = makeDate('2026-01-15T09:00:00');
      expect(computeNextTrigger(now, startAt, base, rule, tz)).toBe(expected);
    });

    test('Custom Months (Every 6 months)', () => {
      const startAt = makeDate('2026-01-01T09:00:00');
      const rule: RepeatRule = { kind: 'custom', frequency: 'months', interval: 6 };
      const base = '2026-01-01T09:00:00';

      const now = makeDate('2026-02-01T00:00:00');

      // Jan 1 + 6 months = July 1
      const expected = makeDate('2026-07-01T09:00:00');
      expect(computeNextTrigger(now, startAt, base, rule, tz)).toBe(expected);
    });
  });

  describe('Timezone-aware (non-UTC)', () => {
    // The original bug: daily repeat at 6:57 PM local, but server (UTC) computes
    // next trigger as 1:57 AM next day instead of 6:57 PM next day.

    test('Daily repeat preserves wall-clock time in Asia/Bangkok (UTC+7)', () => {
      // User sets reminder for 6:57 PM in Asia/Bangkok (UTC+7)
      // 6:57 PM Bangkok = 11:57 AM UTC
      const baseAtLocal = '2026-03-14T18:57:00';
      const dailyRule: RepeatRule = { kind: 'daily', interval: 1 };
      const userTz = 'Asia/Bangkok';

      // Saturday 6:57 PM Bangkok = Saturday 11:57 AM UTC
      const startAt = Date.UTC(2026, 2, 14, 11, 57, 0); // Sat Mar 14 11:57 UTC

      // "now" is right after the Saturday trigger fired (Saturday 12:00 UTC = 7:00 PM Bangkok)
      const now = Date.UTC(2026, 2, 14, 12, 0, 0);

      const next = computeNextTrigger(now, startAt, baseAtLocal, dailyRule, userTz);

      // Next should be Sunday 6:57 PM Bangkok = Sunday 11:57 AM UTC
      const expectedUtc = Date.UTC(2026, 2, 15, 11, 57, 0);
      expect(next).toBe(expectedUtc);
    });

    test('Daily repeat preserves wall-clock time in America/New_York (UTC-5 in winter)', () => {
      const baseAtLocal = '2026-01-15T09:00:00';
      const dailyRule: RepeatRule = { kind: 'daily', interval: 1 };
      const userTz = 'America/New_York';

      // 9:00 AM EST = 2:00 PM UTC
      const startAt = Date.UTC(2026, 0, 15, 14, 0, 0);

      // now = Jan 15 after 9 AM EST (3:00 PM UTC)
      const now = Date.UTC(2026, 0, 15, 15, 0, 0);

      const next = computeNextTrigger(now, startAt, baseAtLocal, dailyRule, userTz);

      // Next: Jan 16 9:00 AM EST = Jan 16 2:00 PM UTC
      const expectedUtc = Date.UTC(2026, 0, 16, 14, 0, 0);
      expect(next).toBe(expectedUtc);
    });

    test('Weekly repeat correct timezone in Europe/London (UTC+1 in summer)', () => {
      const baseAtLocal = '2026-06-01T08:00:00';
      const userTz = 'Europe/London'; // BST = UTC+1 in June
      const rule: RepeatRule = { kind: 'weekly', interval: 1, weekdays: [1] }; // Monday

      // Mon Jun 1 2026. 8:00 AM BST = 7:00 AM UTC
      const startAt = Date.UTC(2026, 5, 1, 7, 0, 0);

      // now = Mon Jun 1, 8:30 AM BST = 7:30 AM UTC
      const now = Date.UTC(2026, 5, 1, 7, 30, 0);

      const next = computeNextTrigger(now, startAt, baseAtLocal, rule, userTz);

      // Next Monday: Jun 8, 8:00 AM BST = 7:00 AM UTC
      const expectedUtc = Date.UTC(2026, 5, 8, 7, 0, 0);
      expect(next).toBe(expectedUtc);
    });

    test('Monthly repeat correct timezone in Asia/Tokyo (UTC+9)', () => {
      const baseAtLocal = '2026-01-15T21:00:00';
      const userTz = 'Asia/Tokyo';
      const rule: RepeatRule = { kind: 'monthly', interval: 1, mode: 'day_of_month' };

      // Jan 15, 9:00 PM JST = Jan 15, 12:00 PM UTC
      const startAt = Date.UTC(2026, 0, 15, 12, 0, 0);

      // now = Jan 16, 1:00 AM JST = Jan 15, 4:00 PM UTC (after the trigger)
      const now = Date.UTC(2026, 0, 15, 16, 0, 0);

      const next = computeNextTrigger(now, startAt, baseAtLocal, rule, userTz);

      // Next: Feb 15, 9:00 PM JST = Feb 15, 12:00 PM UTC
      const expectedUtc = Date.UTC(2026, 1, 15, 12, 0, 0);
      expect(next).toBe(expectedUtc);
    });

    test('The exact reported bug scenario: 6:57 PM daily becomes 1:57 AM without fix', () => {
      // User in UTC+7 creates a daily reminder at 6:57 PM
      const baseAtLocal = '2026-03-14T18:57:00';
      const dailyRule: RepeatRule = { kind: 'daily', interval: 1 };
      const userTz = 'Asia/Bangkok';

      // First trigger: Sat Mar 14, 6:57 PM Bangkok = 11:57 AM UTC
      const startAt = Date.UTC(2026, 2, 14, 11, 57, 0);

      // Now is Sat Mar 14, 7:00 PM Bangkok (just after the noti fires)
      const now = Date.UTC(2026, 2, 14, 12, 0, 0);

      const next = computeNextTrigger(now, startAt, baseAtLocal, dailyRule, userTz);

      // CORRECT: Sun Mar 15, 6:57 PM Bangkok = 11:57 AM UTC
      const correctNext = Date.UTC(2026, 2, 15, 11, 57, 0);
      // BUG would give: Sun Mar 15, 1:57 AM Bangkok = Sat Mar 14, 18:57 UTC
      const buggyNext = Date.UTC(2026, 2, 15, 18, 57, 0);

      expect(next).toBe(correctNext);
      expect(next).not.toBe(buggyNext);
    });
  });
});
