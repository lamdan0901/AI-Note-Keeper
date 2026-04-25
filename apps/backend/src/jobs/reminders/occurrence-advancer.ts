import { createRequire } from 'node:module';

import type { DbQueryClient } from '../../auth/contracts.js';
import { pool } from '../../db/pool.js';
import type { ReminderRepeatRule } from '../../reminders/contracts.js';
import type { DispatchedReminderOccurrence, ReminderOccurrenceAdvancer } from './contracts.js';

type ComputeNextTrigger = (
  now: number,
  startAt: number,
  baseAtLocal: string,
  repeat: ReminderRepeatRule | null,
  timezone?: string,
) => number | null;

const require = createRequire(import.meta.url);

const fallbackComputeNextTrigger: ComputeNextTrigger = (now, startAt, _baseAtLocal, repeat) => {
  if (!repeat) {
    return startAt > now ? startAt : null;
  }

  const toNextByStep = (stepMs: number): number | null => {
    if (!Number.isFinite(stepMs) || stepMs <= 0) {
      return null;
    }

    if (startAt > now) {
      return startAt;
    }

    const elapsed = now - startAt;
    const steps = Math.floor(elapsed / stepMs) + 1;
    return startAt + steps * stepMs;
  };

  if (repeat.kind === 'daily') {
    return toNextByStep(repeat.interval * 24 * 60 * 60 * 1000);
  }

  if (repeat.kind === 'weekly') {
    return toNextByStep(repeat.interval * 7 * 24 * 60 * 60 * 1000);
  }

  if (repeat.kind === 'monthly') {
    const anchor = new Date(startAt);
    if (startAt > now) {
      return anchor.getTime();
    }

    while (anchor.getTime() <= now) {
      anchor.setUTCMonth(anchor.getUTCMonth() + repeat.interval);
    }

    return anchor.getTime();
  }

  if (repeat.kind === 'custom') {
    if (repeat.frequency === 'minutes') {
      return toNextByStep(repeat.interval * 60 * 1000);
    }

    if (repeat.frequency === 'days') {
      return toNextByStep(repeat.interval * 24 * 60 * 60 * 1000);
    }

    if (repeat.frequency === 'weeks') {
      return toNextByStep(repeat.interval * 7 * 24 * 60 * 60 * 1000);
    }

    if (repeat.frequency === 'months') {
      const anchor = new Date(startAt);
      if (startAt > now) {
        return anchor.getTime();
      }

      while (anchor.getTime() <= now) {
        anchor.setUTCMonth(anchor.getUTCMonth() + repeat.interval);
      }

      return anchor.getTime();
    }
  }

  return null;
};

const loadComputeNextTrigger = (): ComputeNextTrigger => {
  try {
    const shared = require('../../../../../packages/shared/utils/recurrence.js') as {
      computeNextTrigger?: ComputeNextTrigger;
    };

    if (typeof shared.computeNextTrigger === 'function') {
      return shared.computeNextTrigger;
    }
  } catch {
    // Backend can run before shared package JS artifacts are built.
  }

  return fallbackComputeNextTrigger;
};

const computeNextTrigger = loadComputeNextTrigger();

export const createReminderOccurrenceAdvancer = (
  deps: Readonly<{ db?: DbQueryClient }> = {},
): ReminderOccurrenceAdvancer => {
  const db = deps.db ?? pool;

  return {
    advanceDispatchedOccurrence: async (occurrence: DispatchedReminderOccurrence) => {
      if (!occurrence.repeat || !occurrence.startAt || !occurrence.baseAtLocal) {
        return;
      }

      const nextMs = computeNextTrigger(
        occurrence.runNow.getTime(),
        occurrence.startAt.getTime(),
        occurrence.baseAtLocal,
        occurrence.repeat,
        occurrence.timezone ?? 'UTC',
      );
      const nextTriggerAt = nextMs === null ? null : new Date(nextMs);
      const scheduleStatus = nextTriggerAt === null ? 'unscheduled' : 'scheduled';

      await db.query(
        `
          UPDATE notes
          SET
            last_fired_at = $1,
            next_trigger_at = $2,
            schedule_status = $3,
            updated_at = GREATEST(updated_at, $4),
            version = COALESCE(version, 1) + 1,
            snoozed_until = NULL
          WHERE id = $5
            AND user_id = $6
            AND active = true
            AND deleted_at IS NULL
            AND COALESCE(snoozed_until, next_trigger_at, trigger_at) = $7
        `,
        [
          occurrence.triggerTime,
          nextTriggerAt,
          scheduleStatus,
          occurrence.runNow,
          occurrence.noteId,
          occurrence.userId,
          occurrence.triggerTime,
        ],
      );
    },
  };
};
