/**
 * notesMigration.ts
 *
 * On-demand Convex mutation to backfill canonical recurrence fields
 * (`repeat`, `startAt`, `baseAtLocal`, `nextTriggerAt`) for notes that were
 * saved before dual-write was introduced.
 *
 * Run in batches via the Convex dashboard or a one-off script:
 *
 *   await client.mutation(api.functions.notesMigration.backfillCanonicalRecurrence, {});
 *
 * Safe to run multiple times – notes that already have canonical `repeat` are skipped.
 * Legacy fields (`repeatRule`, `repeatConfig`) are preserved unchanged.
 */

import { mutation } from '../_generated/server';
import { v } from 'convex/values';

// ---------------------------------------------------------------------------
// Inline repeat coercion (mirrors packages/shared/utils/repeatCodec.ts)
// Convex functions run in a restricted environment, so we keep this self-contained.
// ---------------------------------------------------------------------------

type RepeatRule =
  | { kind: 'daily'; interval: number }
  | { kind: 'weekly'; interval: number; weekdays: number[] }
  | { kind: 'monthly'; interval: number; mode: 'day_of_month' }
  | { kind: 'custom'; interval: number; frequency: 'minutes' | 'days' | 'weeks' | 'months' };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function normalizeInterval(value: unknown, fallback = 1): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

function normalizeWeekdays(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = (value as unknown[])
    .map((e) => Number(e))
    .filter((e) => Number.isInteger(e) && e >= 0 && e <= 6);
  if (parsed.length === 0) return null;
  return Array.from(new Set(parsed)).sort((a, b) => a - b);
}

function normalizeRepeatFromRecord(
  r: Record<string, unknown>,
  triggerAt?: number | null,
): RepeatRule | null {
  const kind = r.kind as string;
  if (kind === 'daily') return { kind: 'daily', interval: normalizeInterval(r.interval) };
  if (kind === 'weekly') {
    return {
      kind: 'weekly',
      interval: normalizeInterval(r.interval),
      weekdays: normalizeWeekdays(r.weekdays) ?? [
        new Date(Number(triggerAt) || Date.now()).getDay(),
      ],
    };
  }
  if (kind === 'monthly') {
    return { kind: 'monthly', interval: normalizeInterval(r.interval), mode: 'day_of_month' };
  }
  if (kind === 'custom') {
    const freq =
      r.frequency === 'minutes' ||
      r.frequency === 'days' ||
      r.frequency === 'weeks' ||
      r.frequency === 'months'
        ? (r.frequency as 'minutes' | 'days' | 'weeks' | 'months')
        : 'days';
    return { kind: 'custom', interval: normalizeInterval(r.interval, 2), frequency: freq };
  }
  return null;
}

function deriveRepeat(
  repeatRule: unknown,
  repeatConfig: unknown,
  triggerAt?: number | null,
): RepeatRule | null {
  const rule = typeof repeatRule === 'string' ? repeatRule : null;
  const config = isRecord(repeatConfig) ? repeatConfig : null;

  if (!rule || rule === 'none') return null;
  if (rule === 'daily') return { kind: 'daily', interval: normalizeInterval(config?.interval) };
  if (rule === 'weekly') {
    return {
      kind: 'weekly',
      interval: normalizeInterval(config?.interval),
      weekdays: normalizeWeekdays(config?.weekdays) ?? [
        new Date(Number(triggerAt) || Date.now()).getDay(),
      ],
    };
  }
  if (rule === 'monthly') {
    return { kind: 'monthly', interval: normalizeInterval(config?.interval), mode: 'day_of_month' };
  }
  if (rule === 'custom') {
    // Mobile legacy: config is spread RepeatRule → has `kind`
    if (config && typeof config.kind === 'string') {
      return normalizeRepeatFromRecord(config, triggerAt);
    }
    // Web legacy: config has `frequency`
    const freq =
      config?.frequency === 'minutes' ||
      config?.frequency === 'days' ||
      config?.frequency === 'weeks' ||
      config?.frequency === 'months'
        ? (config.frequency as 'minutes' | 'days' | 'weeks' | 'months')
        : 'days';
    return { kind: 'custom', interval: normalizeInterval(config?.interval, 2), frequency: freq };
  }
  return null;
}

function isoLocalFromMs(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

// ---------------------------------------------------------------------------
// Mutation
// ---------------------------------------------------------------------------

export const backfillCanonicalRecurrence = mutation({
  args: {
    /** Process at most this many notes per call. Default 200. */
    batchSize: v.optional(v.number()),
    /** Resume from a cursor (internal Convex document ID string). */
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 200;

    // Fetch a page of notes that are missing the canonical `repeat` field
    // and have a legacy repeatRule that is not 'none'.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query = ctx.db.query('notes') as any;

    const page = await query.collect();

    let processed = 0;
    let skipped = 0;
    let patched = 0;
    let lastId: string | null = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const note of page as any[]) {
      processed++;
      lastId = note._id;

      if (processed > batchSize) break;

      // Skip notes that already have canonical `repeat`
      if (
        note.repeat !== undefined &&
        note.repeat !== null &&
        isRecord(note.repeat) &&
        typeof (note.repeat as Record<string, unknown>).kind === 'string'
      ) {
        skipped++;
        continue;
      }

      // Skip non-recurring notes
      if (!note.repeatRule || note.repeatRule === 'none') {
        skipped++;
        continue;
      }

      const repeat = deriveRepeat(note.repeatRule, note.repeatConfig, note.triggerAt);
      if (!repeat) {
        skipped++;
        continue;
      }

      // Determine anchor
      const startAt: number = note.startAt ?? note.triggerAt ?? note.nextTriggerAt ?? Date.now();

      const baseAtLocal: string = note.baseAtLocal ?? isoLocalFromMs(startAt);

      const nextTriggerAt: number =
        note.snoozedUntil ?? note.nextTriggerAt ?? note.triggerAt ?? startAt;

      await ctx.db.patch(note._id, {
        repeat,
        startAt,
        baseAtLocal,
        nextTriggerAt,
        // version bump is intentional so clients see a change
        version: (note.version || 0) + 1,
        updatedAt: note.updatedAt, // preserve original updatedAt to avoid re-sync conflicts
      });

      patched++;
    }

    return {
      processed,
      patched,
      skipped,
      lastId,
      hasMore: processed > batchSize,
    };
  },
});
