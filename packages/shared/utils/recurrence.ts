import { RepeatRule } from '../types/reminder';

// ---------------------------------------------------------------------------
// Timezone-aware helpers
// ---------------------------------------------------------------------------

/** Extract hour/minute/second from a bare local ISO string like "2026-02-01T18:57:00" via parsing. */
function parseLocalTime(baseAtLocal: string): { hour: number; minute: number; second: number } {
  const timePart = baseAtLocal.split('T')[1] ?? '00:00:00';
  const [h, m, s] = timePart.split(':').map(Number);
  return { hour: h || 0, minute: m || 0, second: s || 0 };
}

/** Extract day-of-month from a bare local ISO string. */
function parseLocalDay(baseAtLocal: string): number {
  const datePart = baseAtLocal.split('T')[0] ?? '';
  const day = Number(datePart.split('-')[2]);
  return Number.isFinite(day) ? day : 1;
}

type DateParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0=Sun
};

/** Get calendar parts of an epoch-ms timestamp in a given IANA timezone. */
function datePartsInTz(epochMs: number, tz: string): DateParts {
  const d = new Date(epochMs);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(d);

  const get = (type: string) => {
    const v = parts.find((p) => p.type === type)?.value ?? '0';
    return Number(v);
  };

  const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  let hour = get('hour');
  // Intl with hour12:false can return 24 for midnight in some engines
  if (hour === 24) hour = 0;

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
    weekday: weekdayMap[weekdayStr] ?? 0,
  };
}

/**
 * Convert wall-clock time in a given timezone to epoch ms.
 * Strategy: build a UTC guess, measure the offset via Intl, then adjust.
 */
function wallClockToEpochMs(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  second: number,
  tz: string,
): number {
  // Build a UTC guess
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, 0);

  // What wall-clock time does this UTC instant correspond to in `tz`?
  const actualParts = datePartsInTz(utcGuess, tz);

  // Compute the offset: how far off is actualParts from what we wanted?
  const wantedMinutes = hour * 60 + minute;
  let actualMinutes = actualParts.hour * 60 + actualParts.minute;

  // Handle date boundary: if the actual date differs, account for the day shift
  if (actualParts.day !== day || actualParts.month !== month || actualParts.year !== year) {
    // Build Date objects to measure the day difference
    const wantedDayMs = Date.UTC(year, month - 1, day);
    const actualDayMs = Date.UTC(actualParts.year, actualParts.month - 1, actualParts.day);
    const dayDiffMs = actualDayMs - wantedDayMs;
    actualMinutes += dayDiffMs / 60000;
  }

  const offsetMinutes = actualMinutes - wantedMinutes;
  const result = utcGuess - offsetMinutes * 60000;

  // Verify and fine-tune (handles DST edge cases)
  const verify = datePartsInTz(result, tz);
  if (verify.hour !== hour || verify.minute !== minute) {
    // DST gap: the requested wall-clock time doesn't exist.
    // Move forward to the next valid minute.
    const verifyMinutes = verify.hour * 60 + verify.minute;
    const diff = (hour * 60 + minute - verifyMinutes + 1440) % 1440;
    return result + diff * 60000;
  }

  return result;
}

/** Days in a given month (1-12), accounting for leap years. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getDate();
}

// ---------------------------------------------------------------------------
// computeNextTrigger
// ---------------------------------------------------------------------------

/**
 * Computes the next trigger timestamp based on the repetition rule.
 * All date arithmetic uses the supplied IANA timezone so results are
 * correct regardless of which runtime (device vs UTC server) executes this.
 *
 * @param now Current epoch timestamp
 * @param startAt The anchor timestamp for the series (first occurrence)
 * @param baseAtLocal The ISO string strictly for extracting time-of-day (e.g. "2026-02-01T09:00:00")
 * @param repeat The repeat rule
 * @param timezone IANA timezone string (e.g. "America/New_York")
 * @returns Next trigger timestamp (epoch ms) or null if finished
 */
export function computeNextTrigger(
  now: number,
  startAt: number,
  baseAtLocal: string,
  repeat: RepeatRule | null,
  timezone: string = 'UTC',
): number | null {
  // 1. Non-repeating
  if (!repeat) {
    return startAt > now ? startAt : null;
  }

  // 2. Base checks
  if (startAt > now) {
    return startAt;
  }

  // Parse time of day from baseAtLocal string (NOT via Date constructor)
  const { hour: baseHour, minute: baseMinute, second: baseSecond } = parseLocalTime(baseAtLocal);

  // Get the start date parts in the user's timezone
  const startParts = datePartsInTz(startAt, timezone);

  switch (repeat.kind) {
    case 'daily': {
      const daysSinceStart = Math.floor((now - startAt) / (24 * 60 * 60 * 1000));
      const k = Math.max(0, Math.floor(daysSinceStart / repeat.interval));

      for (let i = 0; i < 10000; i++) {
        const candidateK = k + i;

        // Advance candidateK * interval days from startParts date
        // Use a UTC Date just for calendar arithmetic, then convert via wallClockToEpochMs
        const refDate = new Date(Date.UTC(startParts.year, startParts.month - 1, startParts.day));
        refDate.setUTCDate(refDate.getUTCDate() + candidateK * repeat.interval);

        const candidateMs = wallClockToEpochMs(
          refDate.getUTCFullYear(),
          refDate.getUTCMonth() + 1,
          refDate.getUTCDate(),
          baseHour,
          baseMinute,
          baseSecond,
          timezone,
        );

        if (candidateMs > now) {
          return candidateMs;
        }
      }
      return null;
    }

    case 'weekly': {
      // Find the Sunday of the week containing startAt (in user's timezone)
      const startWeekSunday = new Date(
        Date.UTC(startParts.year, startParts.month - 1, startParts.day - startParts.weekday),
      );

      // Get 'now' parts in user's timezone
      const nowParts = datePartsInTz(now, timezone);
      const nowWeekSunday = new Date(
        Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day - nowParts.weekday),
      );

      const oneWeekDays = 7;
      const weeksDiff = Math.round(
        (nowWeekSunday.getTime() - startWeekSunday.getTime()) / (oneWeekDays * 86400000),
      );

      let targetWeekDiff = Math.max(0, weeksDiff);
      const remainder = targetWeekDiff % repeat.interval;
      if (remainder !== 0) {
        targetWeekDiff += repeat.interval - remainder;
      }

      const sortedWeekdays = [...repeat.weekdays].sort((a, b) => a - b);
      if (sortedWeekdays.length === 0) return null;

      for (let w = 0; w < 10; w++) {
        const diff = targetWeekDiff + w * repeat.interval;
        const weekStart = new Date(startWeekSunday);
        weekStart.setUTCDate(weekStart.getUTCDate() + diff * oneWeekDays);

        for (const dayIdx of sortedWeekdays) {
          const candDate = new Date(weekStart);
          candDate.setUTCDate(candDate.getUTCDate() + dayIdx);

          const candidateMs = wallClockToEpochMs(
            candDate.getUTCFullYear(),
            candDate.getUTCMonth() + 1,
            candDate.getUTCDate(),
            baseHour,
            baseMinute,
            baseSecond,
            timezone,
          );

          if (candidateMs > now) {
            return candidateMs;
          }
        }
      }
      return null;
    }

    case 'monthly': {
      const targetDay = parseLocalDay(baseAtLocal);

      const startYear = startParts.year;
      const startMonth = startParts.month; // 1-12

      const nowParts = datePartsInTz(now, timezone);
      const nowYear = nowParts.year;
      const nowMonth = nowParts.month; // 1-12

      let monthDiff = (nowYear - startYear) * 12 + (nowMonth - startMonth);
      if (monthDiff < 0) monthDiff = 0;

      const rem = monthDiff % repeat.interval;
      let targetMonthDiff = monthDiff;
      if (rem !== 0) {
        targetMonthDiff += repeat.interval - rem;
      }

      for (let i = 0; i < 24; i++) {
        const diff = targetMonthDiff + i * repeat.interval;

        const totalMonths = startMonth - 1 + diff;
        const candidateYear = startYear + Math.floor(totalMonths / 12);
        const candidateMonth = (totalMonths % 12) + 1; // 1-12

        const maxDay = daysInMonth(candidateYear, candidateMonth);
        const actualDay = Math.min(targetDay, maxDay);

        const candidateMs = wallClockToEpochMs(
          candidateYear,
          candidateMonth,
          actualDay,
          baseHour,
          baseMinute,
          baseSecond,
          timezone,
        );

        if (candidateMs > now) {
          return candidateMs;
        }
      }
      return null;
    }

    case 'custom': {
      if (repeat.frequency === 'minutes') {
        const intervalMs = repeat.interval * 60 * 1000;
        if (intervalMs <= 0) return null;
        const elapsed = now - startAt;
        const steps = Math.floor(elapsed / intervalMs) + 1;
        return startAt + steps * intervalMs;
      }
      if (repeat.frequency === 'days') {
        return computeNextTrigger(
          now,
          startAt,
          baseAtLocal,
          {
            kind: 'daily',
            interval: repeat.interval,
          },
          timezone,
        );
      }
      if (repeat.frequency === 'weeks') {
        const startDay = datePartsInTz(startAt, timezone).weekday;
        return computeNextTrigger(
          now,
          startAt,
          baseAtLocal,
          {
            kind: 'weekly',
            interval: repeat.interval,
            weekdays: [startDay],
          },
          timezone,
        );
      }
      if (repeat.frequency === 'months') {
        return computeNextTrigger(
          now,
          startAt,
          baseAtLocal,
          {
            kind: 'monthly',
            interval: repeat.interval,
            mode: 'day_of_month',
          },
          timezone,
        );
      }
      return null;
    }

    default:
      return null;
  }
}
