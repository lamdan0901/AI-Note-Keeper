import assert from "node:assert/strict";
import { test } from "node:test";

import type { ReminderRecord } from "@backend/reminders/contracts";

import { createNotesTrashPurgeJob } from "../src/server/notes-trash-purge";

type QueryCall = Readonly<{
  text: string;
  values: ReadonlyArray<unknown>;
}>;

type TrashRow = Readonly<{
  id: string;
  user_id: string;
  active: boolean;
  deleted_at: Date | null;
  schedule_target_id: string | null;
}>;

const makeTrashRow = (
  input: Readonly<{
    id: string;
    userId: string;
    active: boolean;
    deletedAt: Date | null;
    scheduleTargetId?: string | null;
  }>,
): TrashRow => ({
  id: input.id,
  user_id: input.userId,
  active: input.active,
  deleted_at: input.deletedAt,
  schedule_target_id: input.scheduleTargetId ?? null,
});

/**
 * Mimics the single `DELETE ... WHERE id IN (SELECT ... LIMIT $2) RETURNING`
 * statement: selects matching rows up to the limit, removes them from the
 * backing store, and returns the deleted projection.
 */
const createDbDouble = (rows: TrashRow[], queryCalls: QueryCall[]) => ({
  query: async <T>(text: string, values: ReadonlyArray<unknown> = []) => {
    queryCalls.push({ text, values });

    if (!/delete from notes/i.test(text)) {
      throw new Error(`Unexpected query: ${text}`);
    }

    const cutoff = values[0] as Date;
    const limit = values[1] as number;

    const matching = rows
      .filter(
        (row) =>
          row.active === false &&
          row.deleted_at !== null &&
          row.deleted_at.getTime() <= cutoff.getTime(),
      )
      .sort((left, right) => (left.deleted_at!.getTime() - right.deleted_at!.getTime()))
      .slice(0, limit);

    for (const row of matching) {
      rows.splice(rows.indexOf(row), 1);
    }

    return {
      rows: matching.map((row) => ({
        id: row.id,
        user_id: row.user_id,
        schedule_target_id: row.schedule_target_id,
      })) as T[],
    };
  },
});

const createSchedulerDouble = (canceled: string[], failOn: ReadonlySet<string> = new Set()) => ({
  scheduleNextOccurrence: async () => ({ scheduled: true }),
  cancelCurrentSchedule: async (reminder: ReminderRecord) => {
    if (failOn.has(reminder.id)) {
      throw new Error(`cancel failed for ${reminder.id}`);
    }
    canceled.push(`${reminder.userId}:${reminder.scheduleTargetId}`);
  },
  clearScheduleMetadata: async () => undefined,
});

test("notes trash purge job deletes expired trashed rows and cancels their schedules", async () => {
  const now = new Date("2026-07-05T00:00:00.000Z");
  const expired = new Date("2026-06-20T00:00:00.000Z");
  const fresh = new Date("2026-06-22T00:00:00.001Z");
  const rows = [
    makeTrashRow({
      id: "expired-1",
      userId: "user-1",
      active: false,
      deletedAt: expired,
      scheduleTargetId: "schedule-1",
    }),
    makeTrashRow({ id: "expired-2", userId: "user-2", active: false, deletedAt: expired }),
    makeTrashRow({
      id: "fresh",
      userId: "user-1",
      active: false,
      deletedAt: fresh,
      scheduleTargetId: "schedule-fresh",
    }),
    makeTrashRow({
      id: "active",
      userId: "user-1",
      active: true,
      deletedAt: expired,
      scheduleTargetId: "schedule-active",
    }),
  ];
  const queryCalls: QueryCall[] = [];
  const canceled: string[] = [];

  const job = createNotesTrashPurgeJob({
    db: createDbDouble(rows, queryCalls),
    schedulerService: createSchedulerDouble(canceled),
    now: () => now,
  });

  const result = await job.run();

  assert.deepEqual(result, { scanned: 2, deleted: 2, batches: 1, scheduleCancelFailures: 0 });
  assert.deepEqual(
    rows.map((row) => row.id).sort(),
    ["active", "fresh"],
  );
  assert.deepEqual(canceled, ["user-1:schedule-1"]);
  // Single batch (2 rows < default limit 500) → one DELETE call, default limit passed.
  assert.equal(queryCalls.length, 1);
  assert.match(queryCalls[0]?.text ?? "", /limit \$2/i);
  assert.equal(queryCalls[0]?.values[1], 500);
});

test("notes trash purge job drains the backlog across multiple batches", async () => {
  const now = new Date("2026-07-05T00:00:00.000Z");
  const expired = new Date("2026-06-20T00:00:00.000Z");
  const rows = Array.from({ length: 5 }, (_unused, index) =>
    makeTrashRow({
      id: `expired-${index}`,
      userId: "user-1",
      active: false,
      deletedAt: new Date(expired.getTime() + index),
      scheduleTargetId: index % 2 === 0 ? `schedule-${index}` : null,
    }),
  );
  const queryCalls: QueryCall[] = [];
  const canceled: string[] = [];

  const job = createNotesTrashPurgeJob({
    db: createDbDouble(rows, queryCalls),
    schedulerService: createSchedulerDouble(canceled),
    now: () => now,
  });

  const result = await job.run({ limit: 2 });

  // 5 rows at limit 2 → batches of 2, 2, 1.
  assert.deepEqual(result, { scanned: 5, deleted: 5, batches: 3, scheduleCancelFailures: 0 });
  assert.equal(rows.length, 0);
  assert.equal(queryCalls.length, 3);
  assert.deepEqual(canceled, ["user-1:schedule-0", "user-1:schedule-2", "user-1:schedule-4"]);
});

test("notes trash purge job counts schedule cancel failures without aborting", async () => {
  const now = new Date("2026-07-05T00:00:00.000Z");
  const expired = new Date("2026-06-20T00:00:00.000Z");
  const rows = [
    makeTrashRow({
      id: "expired-1",
      userId: "user-1",
      active: false,
      deletedAt: expired,
      scheduleTargetId: "schedule-1",
    }),
    makeTrashRow({
      id: "expired-2",
      userId: "user-1",
      active: false,
      deletedAt: new Date(expired.getTime() + 1),
      scheduleTargetId: "schedule-2",
    }),
  ];
  const canceled: string[] = [];

  const job = createNotesTrashPurgeJob({
    db: createDbDouble(rows, []),
    schedulerService: createSchedulerDouble(canceled, new Set(["expired-1"])),
    now: () => now,
  });

  const result = await job.run();

  // Both rows deleted even though one schedule cancel threw.
  assert.deepEqual(result, { scanned: 2, deleted: 2, batches: 1, scheduleCancelFailures: 1 });
  assert.equal(rows.length, 0);
  assert.deepEqual(canceled, ["user-1:schedule-2"]);
});

test("notes trash purge job rejects a non-positive or non-integer limit", async () => {
  const job = createNotesTrashPurgeJob({
    db: createDbDouble([], []),
    schedulerService: createSchedulerDouble([]),
    now: () => new Date("2026-07-05T00:00:00.000Z"),
  });

  await assert.rejects(job.run({ limit: 0 }), /positive integer/);
  await assert.rejects(job.run({ limit: -5 }), /positive integer/);
  await assert.rejects(job.run({ limit: 1.5 }), /positive integer/);
});
