import { computeNextTrigger } from './recurrence';
import { RepeatRule } from '../types/reminder';

describe('computeNextTrigger', () => {
  // Helpers
  const makeDate = (iso: string) => new Date(iso).getTime();
  const baseIso = '2026-01-01T09:00:00'; // 9:00 AM. Must match the date used in startAt for correct offset derivation.
  // Ideally, baseIso should match the time in startAt for cleanliness, but the function uses baseIso for the time-of-day target.

  test('Non-repeating future', () => {
    const now = makeDate('2026-01-01T10:00:00');
    const startAt = makeDate('2026-02-01T09:00:00');

    // Should result in startAt
    expect(computeNextTrigger(now, startAt, baseIso, null)).toBe(startAt);
  });

  test('Non-repeating past returns null', () => {
    const now = makeDate('2026-03-01T10:00:00');
    const startAt = makeDate('2026-02-01T09:00:00');

    expect(computeNextTrigger(now, startAt, baseIso, null)).toBeNull();
  });

  test('StartAt equals Now (Strictly future trigger needed)', () => {
    const dailyRule: RepeatRule = { kind: 'daily', interval: 1 };
    const dateStr = '2026-02-01T09:00:00';
    const now = makeDate(dateStr);
    const startAt = makeDate(dateStr);

    // Should skip "now" and go to next interval
    const expected = makeDate('2026-02-02T09:00:00');
    expect(computeNextTrigger(now, startAt, dateStr, dailyRule)).toBe(expected);
  });

  describe('Daily', () => {
    const dailyRule: RepeatRule = { kind: 'daily', interval: 1 };

    test('Next day', () => {
      const startAt = makeDate('2026-01-01T09:00:00'); // Thursday
      const now = makeDate('2026-01-01T10:00:00'); // 1 hour after start

      // Should be Jan 2, 9:00
      const expected = makeDate('2026-01-02T09:00:00');
      expect(computeNextTrigger(now, startAt, baseIso, dailyRule)).toBe(expected);
    });

    test('Skip multiple days', () => {
      const startAt = makeDate('2026-01-01T09:00:00');
      const now = makeDate('2026-01-05T08:00:00'); // Before trigger on Jan 5

      // Should be Jan 5, 9:00 (since 8am < 9am)
      const expected = makeDate('2026-01-05T09:00:00');
      expect(computeNextTrigger(now, startAt, baseIso, dailyRule)).toBe(expected);
    });

    test('Skip multiple days (after time)', () => {
      const startAt = makeDate('2026-01-01T09:00:00');
      const now = makeDate('2026-01-05T10:00:00'); // After trigger on Jan 5

      // Should be Jan 6, 9:00
      const expected = makeDate('2026-01-06T09:00:00');
      expect(computeNextTrigger(now, startAt, baseIso, dailyRule)).toBe(expected);
    });

    test('Daily Interval 3', () => {
      const rule: RepeatRule = { kind: 'daily', interval: 3 };
      const startAt = makeDate('2026-01-01T09:00:00'); // Jan 1
      const now = makeDate('2026-01-02T10:00:00'); // Jan 2

      // Seq: Jan 1, Jan 4, Jan 7...
      // Next after Jan 2 is Jan 4
      const expected = makeDate('2026-01-04T09:00:00');
      expect(computeNextTrigger(now, startAt, baseIso, rule)).toBe(expected);
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
      expect(computeNextTrigger(now, startAt, baseIso, rule)).toBe(expected);
    });

    test('Next week', () => {
      // Repeat Th(4)
      const rule: RepeatRule = { kind: 'weekly', interval: 1, weekdays: [4] };
      const now = makeDate('2026-01-01T10:00:00'); // Th 10am

      // Next is Th Jan 8
      const expected = makeDate('2026-01-08T09:00:00');
      expect(computeNextTrigger(now, startAt, baseIso, rule)).toBe(expected);
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
      expect(computeNextTrigger(now, startAt, baseIso, rule)).toBe(expected);
    });

    test('Empty weekdays returns null', () => {
      const rule: RepeatRule = { kind: 'weekly', interval: 1, weekdays: [] };
      const now = makeDate('2026-01-02T10:00:00');
      expect(computeNextTrigger(now, startAt, baseIso, rule)).toBeNull();
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
      expect(computeNextTrigger(now, startAt, base, rule)).toBe(expected);
    });

    test('End of month clamping (31st)', () => {
      // 31st of Jan
      const startAt = makeDate('2026-01-31T09:00:00');
      const rule: RepeatRule = { kind: 'monthly', interval: 1, mode };
      const base = '2026-01-31T09:00:00';

      const now = makeDate('2026-02-01T00:00:00');

      // Next: Feb 28 (2026 not leap)
      const expected = makeDate('2026-02-28T09:00:00');
      expect(computeNextTrigger(now, startAt, base, rule)).toBe(expected);
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
      expect(computeNextTrigger(now, startAt, base, rule)).toBe(expected);
    });

    test('Leap Year (Jan 31 2028 -> Feb 29 2028)', () => {
      // 2028 is leap year
      const startAt = makeDate('2028-01-31T09:00:00');
      const rule: RepeatRule = { kind: 'monthly', interval: 1, mode };
      const base = '2028-01-31T09:00:00';

      const now = makeDate('2028-02-01T00:00:00');

      // Next: Feb 29
      const expected = makeDate('2028-02-29T09:00:00');
      expect(computeNextTrigger(now, startAt, base, rule)).toBe(expected);
    });

    test('Leap Year to Non-Leap (Feb 29 2028 -> Feb 28 2029)', () => {
      // Start on Leap Day
      const startAt = makeDate('2028-02-29T09:00:00');
      const rule: RepeatRule = { kind: 'monthly', interval: 12, mode }; // Yearly via interval
      const base = '2028-02-29T09:00:00';

      const now = makeDate('2028-03-01T00:00:00');

      // Next year 2029 is not leap. Feb should be 28.
      const expected = makeDate('2029-02-28T09:00:00');
      expect(computeNextTrigger(now, startAt, base, rule)).toBe(expected);
    });

    test('Quarterly (Interval 3)', () => {
      const startAt = makeDate('2026-01-01T09:00:00');
      const rule: RepeatRule = { kind: 'monthly', interval: 3, mode };
      const base = '2026-01-01T09:00:00';

      const now = makeDate('2026-02-01T00:00:00');

      // Next: Apr 1 (Jan + 3 months)
      const expected = makeDate('2026-04-01T09:00:00');
      expect(computeNextTrigger(now, startAt, base, rule)).toBe(expected);
    });
  });

  describe('Custom', () => {
    test('Custom Minutes (Every 3 minutes)', () => {
      const startAt = makeDate('2026-01-01T09:00:00');
      const rule: RepeatRule = { kind: 'custom', frequency: 'minutes', interval: 3 };
      const base = '2026-01-01T09:00:00';

      const now = makeDate('2026-01-01T09:02:00');

      const expected = makeDate('2026-01-01T09:03:00');
      expect(computeNextTrigger(now, startAt, base, rule)).toBe(expected);
    });

    test('Custom Days (Every 5 days)', () => {
      const startAt = makeDate('2026-01-01T09:00:00');
      const rule: RepeatRule = { kind: 'custom', frequency: 'days', interval: 5 };
      const base = '2026-01-01T09:00:00';

      const now = makeDate('2026-01-02T00:00:00');

      // Jan 1 + 5 days = Jan 6
      const expected = makeDate('2026-01-06T09:00:00');
      expect(computeNextTrigger(now, startAt, base, rule)).toBe(expected);
    });

    test('Custom Weeks (Every 2 weeks), implicitly starts on same weekday', () => {
      const startAt = makeDate('2026-01-01T09:00:00'); // Thursday
      const rule: RepeatRule = { kind: 'custom', frequency: 'weeks', interval: 2 };
      const base = '2026-01-01T09:00:00';

      const now = makeDate('2026-01-02T00:00:00');

      // Jan 1 + 14 days = Jan 15
      const expected = makeDate('2026-01-15T09:00:00');
      expect(computeNextTrigger(now, startAt, base, rule)).toBe(expected);
    });

    test('Custom Months (Every 6 months)', () => {
      const startAt = makeDate('2026-01-01T09:00:00');
      const rule: RepeatRule = { kind: 'custom', frequency: 'months', interval: 6 };
      const base = '2026-01-01T09:00:00';

      const now = makeDate('2026-02-01T00:00:00');

      // Jan 1 + 6 months = July 1
      const expected = makeDate('2026-07-01T09:00:00');
      expect(computeNextTrigger(now, startAt, base, rule)).toBe(expected);
    });

    test('Custom Minutes exact boundary skips current slot', () => {
      const startAt = makeDate('2026-01-01T09:00:00');
      const rule: RepeatRule = { kind: 'custom', frequency: 'minutes', interval: 10 };
      const base = '2026-01-01T09:00:00';

      const now = makeDate('2026-01-01T09:10:00');
      const expected = makeDate('2026-01-01T09:20:00');

      expect(computeNextTrigger(now, startAt, base, rule)).toBe(expected);
    });
  });

  describe('Boundary regression checks', () => {
    test('Weekly: after today trigger time, schedule next valid day', () => {
      const startAt = makeDate('2026-01-06T09:00:00'); // Tuesday
      const rule: RepeatRule = { kind: 'weekly', interval: 1, weekdays: [2] }; // Tuesday
      const now = makeDate('2026-01-06T10:00:00');

      const expected = makeDate('2026-01-13T09:00:00');
      expect(computeNextTrigger(now, startAt, '2026-01-06T09:00:00', rule)).toBe(expected);
    });

    test('Monthly: same day after trigger time moves to next month', () => {
      const startAt = makeDate('2026-01-15T09:00:00');
      const rule: RepeatRule = { kind: 'monthly', interval: 1, mode: 'day_of_month' };
      const now = makeDate('2026-01-15T10:00:00');

      const expected = makeDate('2026-02-15T09:00:00');
      expect(computeNextTrigger(now, startAt, '2026-01-15T09:00:00', rule)).toBe(expected);
    });

    test('Custom Days: exact boundary skips to next interval', () => {
      const startAt = makeDate('2026-01-01T09:00:00');
      const rule: RepeatRule = { kind: 'custom', frequency: 'days', interval: 2 };
      const now = makeDate('2026-01-03T09:00:00');

      const expected = makeDate('2026-01-05T09:00:00');
      expect(computeNextTrigger(now, startAt, '2026-01-01T09:00:00', rule)).toBe(expected);
    });
  });

  describe('Timezone-agnostic (UTC+7 user data on UTC server)', () => {
    // Simulate a UTC+7 user: baseAtLocal = "T07:00:00" means 7AM local.
    // startAt epoch = 7AM UTC+7 = midnight UTC.
    // These tests use Date.UTC directly so they pass regardless of the
    // test runner's timezone.
    const OFFSET_HOURS = 7;
    const baseIsoTz = '2026-01-15T07:00:00';
    // 7AM UTC+7 = 0AM UTC on same day
    const startAtTz = Date.UTC(2026, 0, 15, 7, 0, 0) - OFFSET_HOURS * 3600_000;
    // = Date.UTC(2026, 0, 15, 0, 0, 0) = midnight UTC Jan 15

    test('Daily: next trigger is tomorrow 7AM local, not 2PM local', () => {
      // now = 7:30AM local on Jan 15 = 0:30 UTC Jan 15
      const now = startAtTz + 30 * 60_000;
      const rule: RepeatRule = { kind: 'daily', interval: 1 };

      const next = computeNextTrigger(now, startAtTz, baseIsoTz, rule)!;
      // Expected: Jan 16, 7AM UTC+7 = Jan 16, 0AM UTC
      const expected = Date.UTC(2026, 0, 16, 0, 0, 0);
      expect(next).toBe(expected);
    });

    test('Daily interval=2: fires every other day at 7AM local', () => {
      // now = 8AM local Jan 15 = 1AM UTC
      const now = startAtTz + 60 * 60_000;
      const rule: RepeatRule = { kind: 'daily', interval: 2 };

      const next = computeNextTrigger(now, startAtTz, baseIsoTz, rule)!;
      // Expected: Jan 17, 7AM UTC+7 = Jan 17, 0AM UTC
      const expected = Date.UTC(2026, 0, 17, 0, 0, 0);
      expect(next).toBe(expected);
    });

    test('Weekly: Thursday repeat fires at 7AM local next Thursday', () => {
      // Jan 15, 2026 is Thursday
      const startAtW = Date.UTC(2026, 0, 15, 0, 0, 0); // 7AM UTC+7 = 0AM UTC
      const baseW = '2026-01-15T07:00:00';
      const rule: RepeatRule = { kind: 'weekly', interval: 1, weekdays: [4] }; // Thursday

      // now = after 7AM Thu Jan 15
      const now = startAtW + 60 * 60_000;

      const next = computeNextTrigger(now, startAtW, baseW, rule)!;
      // Next Thursday = Jan 22, 7AM UTC+7 = Jan 22 0AM UTC
      const expected = Date.UTC(2026, 0, 22, 0, 0, 0);
      expect(next).toBe(expected);
    });

    test('Monthly: same day next month at 7AM local', () => {
      const rule: RepeatRule = { kind: 'monthly', interval: 1, mode: 'day_of_month' };
      // now = after trigger on Jan 15
      const now = startAtTz + 60 * 60_000;

      const next = computeNextTrigger(now, startAtTz, baseIsoTz, rule)!;
      // Expected: Feb 15, 7AM UTC+7 = Feb 15, 0AM UTC
      const expected = Date.UTC(2026, 1, 15, 0, 0, 0);
      expect(next).toBe(expected);
    });

    test('Result is consistent regardless of where function runs', () => {
      // The key invariant: computeNextTrigger with the SAME (now, startAt,
      // baseAtLocal, repeat) must produce the identical epoch whether
      // the function runs on a UTC server or a UTC+7 client.
      const rule: RepeatRule = { kind: 'daily', interval: 1 };
      const now = startAtTz + 30 * 60_000;

      const result1 = computeNextTrigger(now, startAtTz, baseIsoTz, rule);
      const result2 = computeNextTrigger(now, startAtTz, baseIsoTz, rule);

      expect(result1).toBe(result2);
      // And it should be tomorrow 7AM local = 0AM UTC
      expect(result1).toBe(Date.UTC(2026, 0, 16, 0, 0, 0));
    });
  });
});
