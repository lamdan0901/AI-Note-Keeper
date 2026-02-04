import { RepeatRule } from '../types/reminder';

/**
 * Computes the next trigger timestamp based on the repetition rule.
 * Uses the local device's timezone for all calculations ("Floating Time").
 *
 * @param now Current epoch timestamp
 * @param startAt The anchor timestamp for the series (first occurrence)
 * @param baseAtLocal The ISO string strictly for extracting time-of-day (e.g. "2026-02-01T09:00:00")
 * @param repeat The repeat rule
 * @returns Next trigger timestamp (epoch ms) or null if finished
 */
export function computeNextTrigger(
  now: number,
  startAt: number,
  baseAtLocal: string,
  repeat: RepeatRule | null,
): number | null {
  // 1. Non-repeating
  if (!repeat) {
    return startAt > now ? startAt : null;
  }

  // 2. Base checks
  if (startAt > now) {
    // The series hasn't started yet, or we are before the next known occurrence.
    // However, for repeating reminders, we usually want to find the first one *strict after* now?
    // If startAt is in future, that IS the next occurrence (assuming startAt is valid).
    return startAt;
  }

  // Parse time of day from baseAtLocal
  // We use this to ensure the trigger always lands on the correct wall-clock time
  const baseDate = new Date(baseAtLocal);
  const baseHour = baseDate.getHours();
  const baseMinute = baseDate.getMinutes();
  const baseSecond = baseDate.getSeconds();

  // Start searching from 'now'
  // We want strictly > now
  // const searchStart = new Date(now);

  // For safety, we can start checking from a bit before 'now' relative to startAt intervals,
  // but since we need strictly > now, we can just increment from 'startAt' until we pass 'now'.
  // Optimization: jump closer to 'now'?
  // For daily/simple intervals, we can calculate mathematically.

  const startObj = new Date(startAt);

  switch (repeat.kind) {
    case 'daily': {
      // interval is in days
      const daysSinceStart = Math.floor((now - startAt) / (24 * 60 * 60 * 1000));
      // Potential candidate: startAt + (daysSinceStart * interval)
      // We might need daysSinceStart + 1, or more if the hour passed.

      const k = Math.max(0, Math.floor(daysSinceStart / repeat.interval));

      // Safety cap to prevent infinite loops (though math shouldn't loop)
      for (let i = 0; i < 10000; i++) {
        const candidateK = k + i;
        const candidateTime = new Date(startObj);
        candidateTime.setDate(startObj.getDate() + candidateK * repeat.interval);

        // Align time
        candidateTime.setHours(baseHour, baseMinute, baseSecond, 0);

        if (candidateTime.getTime() > now) {
          return candidateTime.getTime();
        }
      }
      return null;
    }

    case 'weekly': {
      // interval is in weeks
      // weekdays: 0=Sun, 1=Mon, ...

      // Align to start of the "week block" containing startAt
      // We assume standard week starts on Sunday (0) for calculation logic
      // but logic works as long as consistent.
      // Actually, spec says: "weeks_diff = (current_week - start_week) % N"

      // Let's iterate days starting from today?
      // Or jump to the current week.

      // Find the Sunday of the week containing startAt
      const startDay = startObj.getDay();
      const startOfWeekBlock = new Date(startObj);
      startOfWeekBlock.setDate(startObj.getDate() - startDay);
      startOfWeekBlock.setHours(0, 0, 0, 0);

      // Find the Sunday of the week containing 'now'
      const nowObj = new Date(now);
      const nowDay = nowObj.getDay();
      const currentWeekStart = new Date(nowObj);
      currentWeekStart.setDate(nowObj.getDate() - nowDay);
      currentWeekStart.setHours(0, 0, 0, 0);

      const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
      const weeksDiff = Math.round(
        (currentWeekStart.getTime() - startOfWeekBlock.getTime()) / oneWeekMs,
      );

      // We need a week W such that (W - StartW) % interval == 0
      // Find the current or next valid week block
      let targetWeekDiff = weeksDiff;
      if (targetWeekDiff < 0) targetWeekDiff = 0; // Should not happen if startAt <= now

      // Adjust targetWeekDiff to match interval
      const remainder = targetWeekDiff % repeat.interval;
      if (remainder !== 0) {
        targetWeekDiff += repeat.interval - remainder;
      }

      // Sort weekdays to be sure
      const sortedWeekdays = [...repeat.weekdays].sort((a, b) => a - b);
      if (sortedWeekdays.length === 0) return null; // Invalid rule?

      // Iterate next few valid weeks
      for (let w = 0; w < 10; w++) {
        // Check 10 recurring weeks ahead
        const diff = targetWeekDiff + w * repeat.interval;
        const weekStartMs = startOfWeekBlock.getTime() + diff * oneWeekMs;
        const weekStartObj = new Date(weekStartMs);

        // Check days in this week
        for (const dayIdx of sortedWeekdays) {
          const candidate = new Date(weekStartObj);
          candidate.setDate(weekStartObj.getDate() + dayIdx);
          candidate.setHours(baseHour, baseMinute, baseSecond, 0);

          if (candidate.getTime() > now) {
            return candidate.getTime();
          }
        }
      }
      return null;
    }

    case 'monthly': {
      // interval in months
      // mode: 'day_of_month' -> same numeric day, clamped

      // Parse target day from baseAtLocal
      const targetDay = baseDate.getDate(); // e.g. 31

      // Start iterating months from startAt
      // We need month M such that (M - StartM) % interval == 0

      const startYear = startObj.getFullYear();
      const startMonth = startObj.getMonth();

      const nowYear = new Date(now).getFullYear();
      const nowMonth = new Date(now).getMonth();

      let monthDiff = (nowYear - startYear) * 12 + (nowMonth - startMonth);
      if (monthDiff < 0) monthDiff = 0;

      const remainder = monthDiff % repeat.interval;
      let targetMonthDiff = monthDiff;
      if (remainder !== 0) {
        targetMonthDiff += repeat.interval - remainder;
      } else {
        // We are in a valid month, check if we passed the day
        // We will check inside the loop
      }

      // Check next few valid months
      for (let i = 0; i < 24; i++) {
        // Check 2 years worth?
        const diff = targetMonthDiff + i * repeat.interval;

        const candidateYear = startYear + Math.floor((startMonth + diff) / 12);
        const candidateMonth = (startMonth + diff) % 12;

        // Construct date: Year, Month, 1
        // Then set date to targetDay, clamping to max days in month
        const daysInMonth = new Date(candidateYear, candidateMonth + 1, 0).getDate();
        const actualDay = Math.min(targetDay, daysInMonth);

        const candidate = new Date(candidateYear, candidateMonth, actualDay);
        candidate.setHours(baseHour, baseMinute, baseSecond, 0);

        if (candidate.getTime() > now) {
          return candidate.getTime();
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
        return computeNextTrigger(now, startAt, baseAtLocal, {
          kind: 'daily',
          interval: repeat.interval,
        });
      }
      if (repeat.frequency === 'weeks') {
        const startDay = startObj.getDay();
        return computeNextTrigger(now, startAt, baseAtLocal, {
          kind: 'weekly',
          interval: repeat.interval,
          weekdays: [startDay], // Implicitly same day of week
        });
      }
      if (repeat.frequency === 'months') {
        return computeNextTrigger(now, startAt, baseAtLocal, {
          kind: 'monthly',
          interval: repeat.interval,
          mode: 'day_of_month',
        });
      }
      return null;
    }

    default:
      return null;
  }
}
