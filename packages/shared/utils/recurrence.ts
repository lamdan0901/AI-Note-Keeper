import { RepeatRule } from '../types/reminder';

/**
 * Computes the next trigger timestamp based on the repetition rule.
 * Timezone-agnostic: derives the user's UTC offset from the (startAt, baseAtLocal)
 * pair, then performs all date arithmetic in UTC so results are identical
 * regardless of the runtime's local timezone.
 *
 * @param now Current epoch timestamp
 * @param startAt The anchor timestamp for the series (first occurrence epoch ms)
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
    return startAt;
  }

  // --- Timezone-agnostic parsing ---
  // Parse wall-clock components from baseAtLocal WITHOUT using new Date(),
  // which would apply the runtime's local timezone and produce wrong results
  // when the server timezone differs from the user's timezone.
  const [datePart, timePart] = baseAtLocal.split('T');
  const [yearStr, monthStr, dayStr] = datePart.split('-');
  const timeParts = (timePart || '00:00:00').split(':');
  const baseYear = parseInt(yearStr, 10);
  const baseMonth = parseInt(monthStr, 10) - 1; // 0-indexed for Date.UTC
  const baseDay = parseInt(dayStr, 10);
  const baseHour = parseInt(timeParts[0], 10);
  const baseMinute = parseInt(timeParts[1], 10);
  const baseSecond = parseInt(timeParts[2] || '0', 10);

  // Derive the user's timezone offset from the (startAt, baseAtLocal) pair.
  // baseAtLocal interpreted as UTC gives an epoch; the difference from the
  // real epoch (startAt) is the user's UTC offset at creation time.
  const baseAsUtcEpoch = Date.UTC(baseYear, baseMonth, baseDay, baseHour, baseMinute, baseSecond);
  const offsetMs = baseAsUtcEpoch - startAt;

  // Shift epochs into "local-as-UTC" space so UTC Date methods behave
  // as if they were local-timezone methods.
  const nowL = now + offsetMs;
  const startL = startAt + offsetMs; // equals baseAsUtcEpoch
  const startObj = new Date(startL);

  switch (repeat.kind) {
    case 'daily': {
      const daysSinceStart = Math.floor((nowL - startL) / (24 * 60 * 60 * 1000));
      const k = Math.max(0, Math.floor(daysSinceStart / repeat.interval));

      for (let i = 0; i < 10000; i++) {
        const candidateK = k + i;
        const candidateTime = new Date(startL);
        candidateTime.setUTCDate(startObj.getUTCDate() + candidateK * repeat.interval);
        candidateTime.setUTCHours(baseHour, baseMinute, baseSecond, 0);

        const candidateEpoch = candidateTime.getTime() - offsetMs;
        if (candidateEpoch > now) {
          return candidateEpoch;
        }
      }
      return null;
    }

    case 'weekly': {
      const startDay = startObj.getUTCDay();
      const startOfWeekBlock = new Date(startL);
      startOfWeekBlock.setUTCDate(startObj.getUTCDate() - startDay);
      startOfWeekBlock.setUTCHours(0, 0, 0, 0);

      const nowObj = new Date(nowL);
      const nowDay = nowObj.getUTCDay();
      const currentWeekStart = new Date(nowL);
      currentWeekStart.setUTCDate(nowObj.getUTCDate() - nowDay);
      currentWeekStart.setUTCHours(0, 0, 0, 0);

      const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
      const weeksDiff = Math.round(
        (currentWeekStart.getTime() - startOfWeekBlock.getTime()) / oneWeekMs,
      );

      let targetWeekDiff = weeksDiff;
      if (targetWeekDiff < 0) targetWeekDiff = 0;

      const remainder = targetWeekDiff % repeat.interval;
      if (remainder !== 0) {
        targetWeekDiff += repeat.interval - remainder;
      }

      const sortedWeekdays = [...repeat.weekdays].sort((a, b) => a - b);
      if (sortedWeekdays.length === 0) return null;

      for (let w = 0; w < 10; w++) {
        const diff = targetWeekDiff + w * repeat.interval;
        const weekStartMs = startOfWeekBlock.getTime() + diff * oneWeekMs;
        const weekStartObj = new Date(weekStartMs);

        for (const dayIdx of sortedWeekdays) {
          const candidate = new Date(weekStartMs);
          candidate.setUTCDate(weekStartObj.getUTCDate() + dayIdx);
          candidate.setUTCHours(baseHour, baseMinute, baseSecond, 0);

          const candidateEpoch = candidate.getTime() - offsetMs;
          if (candidateEpoch > now) {
            return candidateEpoch;
          }
        }
      }
      return null;
    }

    case 'monthly': {
      const targetDay = baseDay;

      const startYear = startObj.getUTCFullYear();
      const startMonth = startObj.getUTCMonth();

      const nowObj = new Date(nowL);
      const nowYear = nowObj.getUTCFullYear();
      const nowMonth = nowObj.getUTCMonth();

      let monthDiff = (nowYear - startYear) * 12 + (nowMonth - startMonth);
      if (monthDiff < 0) monthDiff = 0;

      const remainderM = monthDiff % repeat.interval;
      let targetMonthDiff = monthDiff;
      if (remainderM !== 0) {
        targetMonthDiff += repeat.interval - remainderM;
      }

      for (let i = 0; i < 24; i++) {
        const diff = targetMonthDiff + i * repeat.interval;

        const candidateYear = startYear + Math.floor((startMonth + diff) / 12);
        const candidateMonth = (startMonth + diff) % 12;

        const daysInMonth = new Date(Date.UTC(candidateYear, candidateMonth + 1, 0)).getUTCDate();
        const actualDay = Math.min(targetDay, daysInMonth);

        const candidateMs = Date.UTC(
          candidateYear, candidateMonth, actualDay,
          baseHour, baseMinute, baseSecond,
        );
        const candidateEpoch = candidateMs - offsetMs;

        if (candidateEpoch > now) {
          return candidateEpoch;
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
        const weekday = startObj.getUTCDay();
        return computeNextTrigger(now, startAt, baseAtLocal, {
          kind: 'weekly',
          interval: repeat.interval,
          weekdays: [weekday],
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
