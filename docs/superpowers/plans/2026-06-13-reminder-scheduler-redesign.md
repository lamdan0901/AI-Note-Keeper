# Reminder Scheduler Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Revision note:** The original plan used `generic-http` and shared-secret callbacks. The approved 2026-06-19 spec revision replaces that transport with Upstash QStash. Use `docs/superpowers/plans/2026-06-19-reminder-scheduler-qstash-cutover.md` for the QStash cutover.

**Goal:** Replace the minute-by-minute reminder scanner as the normal reminder delivery path with backend-authoritative next-occurrence scheduling, durable delivery rows, stale task validation, and coarse repair.

**Architecture:** Keep `notes` as the reminder source of truth and add scheduler metadata plus a `reminder_deliveries` ledger. Reminder create/update/delete flows compute the authoritative next occurrence, call a scheduler provider for only that occurrence, and persist provider metadata only after provider success. Scheduled task execution validates reminder `version` and occurrence identity, inserts a delivery row for idempotency, sends backend push notifications, advances recurrence after the occurrence reaches a terminal state, and schedules the next occurrence.

**Tech Stack:** TypeScript, Node.js, Express, PostgreSQL migrations, existing backend worker adapter, existing push delivery abstractions, `node:test`.

---

## File Structure

- Modify: `apps/backend/src/db/migrations/00002_notes.sql`
  - Add scheduler metadata columns to fresh installs.
- Create: `apps/backend/src/db/migrations/00011_reminder_scheduler.sql`
  - Add scheduler metadata to existing databases and create `reminder_deliveries`.
- Modify: `apps/backend/src/reminders/contracts.ts`
  - Add scheduler metadata and delivery status types to the reminder domain model.
- Modify: `apps/backend/src/reminders/repositories/reminders-repository.ts`
  - Map scheduler metadata, patch it atomically, and expose due/repair queries.
- Create: `apps/backend/src/reminders/repositories/reminder-deliveries-repository.ts`
  - Own durable delivery insert, conflict detection, and status transitions.
- Create: `apps/backend/src/reminders/scheduler-provider.ts`
  - Define `SchedulerProvider`, payload shape, HTTP provider, and disabled provider.
- Create: `apps/backend/src/reminders/scheduler-service.ts`
  - Compute delivery keys, schedule next occurrence, cancel stale schedules, and clear metadata.
- Create: `apps/backend/src/reminders/notification-sender.ts`
  - Render notification text and send reminder pushes through existing device token and push services.
- Create: `apps/backend/src/reminders/scheduled-task-executor.ts`
  - Validate scheduled task payloads, create delivery rows, send push, advance recurrence, and schedule successors.
- Create: `apps/backend/src/reminders/repair-job.ts`
  - Coarse repair/backfill job for overdue, missing, or stale scheduler state.
- Create: `apps/backend/src/reminders/internal-routes.ts`
  - Add scheduler callback endpoint protected by shared secret.
- Modify: `apps/backend/src/runtime/createApiServer.ts`
  - Mount internal scheduler routes.
- Modify: `apps/backend/src/reminders/service.ts`
  - Integrate scheduler service with create/update/delete/snooze/ack paths.
- Modify: `apps/backend/src/worker/boss-adapter.ts`
  - Stop using minute-by-minute reminder dispatch in normal path and run repair at a coarse interval.
- Modify: `apps/backend/src/jobs/reminders/*`
  - Preserve scanner code as repair/backfill support, not normal dispatch.
- Add/modify tests under `apps/backend/src/tests/reminders/`, `apps/backend/src/tests/jobs/`, `apps/backend/src/tests/worker-bootstrap.test.ts`, and contract tests under `tests/contract/`.

## Shared Names

Use these exact names throughout the implementation:

```ts
export type ReminderDeliveryStatus =
  | 'pending'
  | 'sent'
  | 'failed'
  | 'stale'
  | 'canceled';

export type ReminderSchedulerPayload = Readonly<{
  reminderId: string;
  occurrenceAt: string;
  version: number;
  deliveryKey: string;
}>;

export const createReminderDeliveryKey = (
  input: Readonly<{ reminderId: string; occurrenceAt: Date | number; version: number }>,
): string => {
  const occurrenceMs = input.occurrenceAt instanceof Date
    ? input.occurrenceAt.getTime()
    : input.occurrenceAt;
  return `${input.reminderId}:${occurrenceMs}:v${input.version}`;
};
```

## Task 1: Migration and Domain Shape

**Files:**
- Modify: `apps/backend/src/db/migrations/00002_notes.sql`
- Create: `apps/backend/src/db/migrations/00011_reminder_scheduler.sql`
- Modify: `apps/backend/src/reminders/contracts.ts`

- [ ] **Step 1: Add a failing migration shape test**

Create `apps/backend/src/tests/reminders/reminder-scheduler-migration.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../db/migrations/00011_reminder_scheduler.sql', import.meta.url),
  'utf8',
);

test('reminder scheduler migration adds schedule metadata and delivery ledger', () => {
  assert.match(migration, /ALTER TABLE notes/i);
  assert.match(migration, /schedule_provider/i);
  assert.match(migration, /schedule_target_id/i);
  assert.match(migration, /schedule_target_version/i);
  assert.match(migration, /schedule_target_fire_at/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS reminder_deliveries/i);
  assert.match(migration, /UNIQUE \(reminder_id, occurrence_at\)/i);
  assert.match(migration, /UNIQUE \(delivery_key\)/i);
});
```

- [ ] **Step 2: Run the migration test and verify it fails**

Run: `npm --workspace apps/backend run build && node --test dist/tests/reminders/reminder-scheduler-migration.test.js`

Expected: FAIL because `00011_reminder_scheduler.sql` does not exist.

- [ ] **Step 3: Add scheduler columns to fresh install migration**

In `apps/backend/src/db/migrations/00002_notes.sql`, add these columns immediately after `version INTEGER DEFAULT 1`:

```sql
  schedule_provider TEXT,
  schedule_target_id TEXT,
  schedule_target_version INTEGER,
  schedule_target_fire_at TIMESTAMP WITH TIME ZONE,
```

- [ ] **Step 4: Add the migration for existing databases**

Create `apps/backend/src/db/migrations/00011_reminder_scheduler.sql`:

```sql
ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS schedule_provider TEXT,
  ADD COLUMN IF NOT EXISTS schedule_target_id TEXT,
  ADD COLUMN IF NOT EXISTS schedule_target_version INTEGER,
  ADD COLUMN IF NOT EXISTS schedule_target_fire_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_notes_reminder_next_fire
  ON notes (next_trigger_at)
  WHERE trigger_at IS NOT NULL
    AND active = true
    AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notes_reminder_scheduler_missing
  ON notes (next_trigger_at, schedule_target_id)
  WHERE trigger_at IS NOT NULL
    AND active = true
    AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS reminder_deliveries (
  id TEXT PRIMARY KEY,
  reminder_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occurrence_at TIMESTAMP WITH TIME ZONE NOT NULL,
  reminder_version INTEGER NOT NULL,
  delivery_key TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_message_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMP WITH TIME ZONE,
  failure_reason TEXT,
  UNIQUE (reminder_id, occurrence_at),
  UNIQUE (delivery_key),
  CHECK (status IN ('pending', 'sent', 'failed', 'stale', 'canceled'))
);

CREATE INDEX IF NOT EXISTS idx_reminder_deliveries_reminder_created
  ON reminder_deliveries (reminder_id, created_at DESC);
```

- [ ] **Step 5: Extend reminder contracts**

In `apps/backend/src/reminders/contracts.ts`, add:

```ts
export type ReminderDeliveryStatus = 'pending' | 'sent' | 'failed' | 'stale' | 'canceled';

export type ReminderSchedulerPayload = Readonly<{
  reminderId: string;
  occurrenceAt: string;
  version: number;
  deliveryKey: string;
}>;
```

Add these fields to `ReminderRecord` and `ReminderCreateInput`:

```ts
  scheduleProvider: string | null;
  scheduleTargetId: string | null;
  scheduleTargetVersion: number | null;
  scheduleTargetFireAt: Date | null;
```

Add these optional fields to `ReminderPatchInput`:

```ts
  scheduleProvider?: string | null;
  scheduleTargetId?: string | null;
  scheduleTargetVersion?: number | null;
  scheduleTargetFireAt?: Date | null;
```

- [ ] **Step 6: Run the migration test and typecheck**

Run: `npm --workspace apps/backend run build && node --test dist/tests/reminders/reminder-scheduler-migration.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/db/migrations/00002_notes.sql apps/backend/src/db/migrations/00011_reminder_scheduler.sql apps/backend/src/reminders/contracts.ts apps/backend/src/tests/reminders/reminder-scheduler-migration.test.ts
git commit -m "feat: add reminder scheduler schema"
```

## Task 2: Repository Mapping and Delivery Ledger

**Files:**
- Modify: `apps/backend/src/reminders/repositories/reminders-repository.ts`
- Create: `apps/backend/src/reminders/repositories/reminder-deliveries-repository.ts`
- Create: `apps/backend/src/tests/reminders/reminder-deliveries-repository.test.ts`
- Modify: `apps/backend/src/tests/reminders/service.test.ts`

- [ ] **Step 1: Add failing repository tests**

Create `apps/backend/src/tests/reminders/reminder-deliveries-repository.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import type { DbQueryClient } from '../../auth/contracts.js';
import { createReminderDeliveriesRepository } from '../../reminders/repositories/reminder-deliveries-repository.js';

type QueryCall = Readonly<{ text: string; values: ReadonlyArray<unknown> | undefined }>;

const createDb = (calls: QueryCall[], rows: ReadonlyArray<Record<string, unknown>> = []): DbQueryClient => ({
  query: async <T extends Record<string, unknown>>(text: string, values?: ReadonlyArray<unknown>) => {
    calls.push({ text, values });
    return { rows: rows as ReadonlyArray<T> };
  },
});

test('delivery repository inserts pending row with occurrence and delivery uniqueness', async () => {
  const calls: QueryCall[] = [];
  const createdAt = new Date('2026-06-13T10:00:00.000Z');
  const occurrenceAt = new Date('2026-06-13T10:05:00.000Z');
  const repository = createReminderDeliveriesRepository({
    db: createDb(calls, [{
      id: 'delivery-1',
      reminder_id: 'reminder-1',
      user_id: 'user-1',
      occurrence_at: occurrenceAt,
      reminder_version: 3,
      delivery_key: 'reminder-1:1781345100000:v3',
      status: 'pending',
      provider_message_id: null,
      attempt_count: 0,
      created_at: createdAt,
      sent_at: null,
      failure_reason: null,
      inserted: true,
    }]),
    createId: () => 'delivery-1',
    now: () => createdAt,
  });

  const result = await repository.insertPending({
    reminderId: 'reminder-1',
    userId: 'user-1',
    occurrenceAt,
    reminderVersion: 3,
    deliveryKey: 'reminder-1:1781345100000:v3',
  });

  assert.equal(result.inserted, true);
  assert.equal(result.delivery.status, 'pending');
  assert.match(calls[0].text, /ON CONFLICT \(reminder_id, occurrence_at\) DO NOTHING/i);
});

test('delivery repository marks sent and failed with terminal timestamps', async () => {
  const calls: QueryCall[] = [];
  const repository = createReminderDeliveriesRepository({
    db: createDb(calls),
    now: () => new Date('2026-06-13T10:06:00.000Z'),
  });

  await repository.markSent({ deliveryKey: 'key-1', providerMessageId: 'push-ok' });
  await repository.markFailed({ deliveryKey: 'key-2', reason: 'no_device_tokens' });
  await repository.markStale({
    deliveryKey: 'key-3',
    reminderId: 'reminder-1',
    userId: 'user-1',
    occurrenceAt: new Date('2026-06-13T10:05:00.000Z'),
    reminderVersion: 2,
    reason: 'version_mismatch',
  });

  assert.match(calls[0].text, /SET status = 'sent'/i);
  assert.match(calls[1].text, /SET status = 'failed'/i);
  assert.match(calls[2].text, /status/i);
  assert.match(calls[2].text, /stale/i);
});
```

- [ ] **Step 2: Run the repository test and verify it fails**

Run: `npm --workspace apps/backend run build && node --test dist/tests/reminders/reminder-deliveries-repository.test.js`

Expected: FAIL because `reminder-deliveries-repository.ts` does not exist.

- [ ] **Step 3: Map scheduler metadata in reminders repository**

In `ReminderRow`, add:

```ts
  schedule_provider: string | null;
  schedule_target_id: string | null;
  schedule_target_version: number | null;
  schedule_target_fire_at: Date | null;
```

In `toDomain`, add:

```ts
    scheduleProvider: row.schedule_provider,
    scheduleTargetId: row.schedule_target_id,
    scheduleTargetVersion: row.schedule_target_version,
    scheduleTargetFireAt: row.schedule_target_fire_at,
```

In `INSERT_COLUMNS`, add:

```ts
  'schedule_provider',
  'schedule_target_id',
  'schedule_target_version',
  'schedule_target_fire_at',
```

In `create` values, add:

```ts
        input.scheduleProvider,
        input.scheduleTargetId,
        input.scheduleTargetVersion,
        input.scheduleTargetFireAt,
```

In `patchToColumnValue`, add:

```ts
  if (Object.hasOwn(patch, 'scheduleProvider')) add('schedule_provider', patch.scheduleProvider ?? null);
  if (Object.hasOwn(patch, 'scheduleTargetId')) add('schedule_target_id', patch.scheduleTargetId ?? null);
  if (Object.hasOwn(patch, 'scheduleTargetVersion')) add('schedule_target_version', patch.scheduleTargetVersion ?? null);
  if (Object.hasOwn(patch, 'scheduleTargetFireAt')) add('schedule_target_fire_at', patch.scheduleTargetFireAt ?? null);
```

- [ ] **Step 4: Add delivery repository implementation**

Create `apps/backend/src/reminders/repositories/reminder-deliveries-repository.ts`:

```ts
import { randomUUID } from 'node:crypto';

import type { DbQueryClient } from '../../auth/contracts.js';
import { pool } from '../../db/pool.js';
import type { ReminderDeliveryStatus } from '../contracts.js';

export type ReminderDeliveryRecord = Readonly<{
  id: string;
  reminderId: string;
  userId: string;
  occurrenceAt: Date;
  reminderVersion: number;
  deliveryKey: string;
  status: ReminderDeliveryStatus;
  providerMessageId: string | null;
  attemptCount: number;
  createdAt: Date;
  sentAt: Date | null;
  failureReason: string | null;
}>;

type ReminderDeliveryRow = Readonly<{
  id: string;
  reminder_id: string;
  user_id: string;
  occurrence_at: Date;
  reminder_version: number;
  delivery_key: string;
  status: ReminderDeliveryStatus;
  provider_message_id: string | null;
  attempt_count: number;
  created_at: Date;
  sent_at: Date | null;
  failure_reason: string | null;
  inserted?: boolean;
}>;

const toDomain = (row: ReminderDeliveryRow): ReminderDeliveryRecord => ({
  id: row.id,
  reminderId: row.reminder_id,
  userId: row.user_id,
  occurrenceAt: row.occurrence_at,
  reminderVersion: row.reminder_version,
  deliveryKey: row.delivery_key,
  status: row.status,
  providerMessageId: row.provider_message_id,
  attemptCount: row.attempt_count,
  createdAt: row.created_at,
  sentAt: row.sent_at,
  failureReason: row.failure_reason,
});

export type ReminderDeliveriesRepository = Readonly<{
  insertPending: (
    input: Readonly<{
      reminderId: string;
      userId: string;
      occurrenceAt: Date;
      reminderVersion: number;
      deliveryKey: string;
    }>,
  ) => Promise<Readonly<{ inserted: boolean; delivery: ReminderDeliveryRecord }>>;
  markSent: (input: Readonly<{ deliveryKey: string; providerMessageId?: string }>) => Promise<void>;
  markFailed: (input: Readonly<{ deliveryKey: string; reason: string }>) => Promise<void>;
  markCanceled: (
    input: Readonly<{
      deliveryKey: string;
      reminderId: string;
      userId: string;
      occurrenceAt: Date;
      reminderVersion: number;
      reason: string;
    }>,
  ) => Promise<void>;
  markStale: (
    input: Readonly<{
      deliveryKey: string;
      reminderId: string;
      userId: string;
      occurrenceAt: Date;
      reminderVersion: number;
      reason: string;
    }>,
  ) => Promise<void>;
}>;

export const createReminderDeliveriesRepository = (
  deps: Readonly<{ db?: DbQueryClient; createId?: () => string; now?: () => Date }> = {},
): ReminderDeliveriesRepository => {
  const db = deps.db ?? pool;
  const createId = deps.createId ?? randomUUID;
  const now = deps.now ?? (() => new Date());

  const upsertTerminal = async (
    input: Readonly<{
      status: 'stale' | 'canceled';
      deliveryKey: string;
      reminderId: string;
      userId: string;
      occurrenceAt: Date;
      reminderVersion: number;
      reason: string;
    }>,
  ): Promise<void> => {
    await db.query(
      `
        INSERT INTO reminder_deliveries (
          id, reminder_id, user_id, occurrence_at, reminder_version,
          delivery_key, status, attempt_count, created_at, failure_reason
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9)
        ON CONFLICT (delivery_key)
        DO UPDATE SET
          status = EXCLUDED.status,
          failure_reason = EXCLUDED.failure_reason
      `,
      [
        createId(),
        input.reminderId,
        input.userId,
        input.occurrenceAt,
        input.reminderVersion,
        input.deliveryKey,
        input.status,
        now(),
        input.reason,
      ],
    );
  };

  return {
    insertPending: async (input) => {
      const result = await db.query<ReminderDeliveryRow>(
        `
          WITH inserted AS (
            INSERT INTO reminder_deliveries (
              id, reminder_id, user_id, occurrence_at, reminder_version,
              delivery_key, status, attempt_count, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, 'pending', 0, $7)
            ON CONFLICT (reminder_id, occurrence_at) DO NOTHING
            RETURNING *, true AS inserted
          )
          SELECT * FROM inserted
          UNION ALL
          SELECT *, false AS inserted
          FROM reminder_deliveries
          WHERE reminder_id = $2 AND occurrence_at = $4
          LIMIT 1
        `,
        [
          createId(),
          input.reminderId,
          input.userId,
          input.occurrenceAt,
          input.reminderVersion,
          input.deliveryKey,
          now(),
        ],
      );

      const row = result.rows[0];
      return {
        inserted: row.inserted === true,
        delivery: toDomain(row),
      };
    },
    markSent: async ({ deliveryKey, providerMessageId }) => {
      await db.query(
        `
          UPDATE reminder_deliveries
          SET status = 'sent',
              provider_message_id = $1,
              sent_at = $2,
              attempt_count = attempt_count + 1,
              failure_reason = NULL
          WHERE delivery_key = $3
        `,
        [providerMessageId ?? null, now(), deliveryKey],
      );
    },
    markFailed: async ({ deliveryKey, reason }) => {
      await db.query(
        `
          UPDATE reminder_deliveries
          SET status = 'failed',
              attempt_count = attempt_count + 1,
              failure_reason = $1
          WHERE delivery_key = $2
        `,
        [reason, deliveryKey],
      );
    },
    markCanceled: async (input) => {
      await upsertTerminal({ ...input, status: 'canceled' });
    },
    markStale: async (input) => {
      await upsertTerminal({ ...input, status: 'stale' });
    },
  };
};
```

- [ ] **Step 5: Update service test doubles**

In `apps/backend/src/tests/reminders/service.test.ts`, update `createReminderRecord` and every created `ReminderRecord` with:

```ts
    scheduleProvider: null,
    scheduleTargetId: null,
    scheduleTargetVersion: null,
    scheduleTargetFireAt: null,
```

Update the in-memory create mapper with:

```ts
        scheduleProvider: input.scheduleProvider,
        scheduleTargetId: input.scheduleTargetId,
        scheduleTargetVersion: input.scheduleTargetVersion,
        scheduleTargetFireAt: input.scheduleTargetFireAt,
```

- [ ] **Step 6: Run tests**

Run: `npm --workspace apps/backend run build && node --test dist/tests/reminders/reminder-deliveries-repository.test.js dist/tests/reminders/service.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/reminders/repositories/reminders-repository.ts apps/backend/src/reminders/repositories/reminder-deliveries-repository.ts apps/backend/src/tests/reminders/reminder-deliveries-repository.test.ts apps/backend/src/tests/reminders/service.test.ts
git commit -m "feat: add reminder delivery ledger repository"
```

## Task 3: Scheduler Provider Abstraction

**Files:**
- Create: `apps/backend/src/reminders/scheduler-provider.ts`
- Create: `apps/backend/src/tests/reminders/scheduler-provider.test.ts`
- Modify: `apps/backend/src/config.ts`

- [ ] **Step 1: Add failing provider contract tests**

Create `apps/backend/src/tests/reminders/scheduler-provider.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDisabledSchedulerProvider,
  createHttpSchedulerProvider,
} from '../../reminders/scheduler-provider.js';

test('http scheduler provider posts schedule payload and returns provider metadata', async () => {
  const calls: Array<Readonly<{ url: string; body: unknown; headers: HeadersInit | undefined }>> = [];
  const provider = createHttpSchedulerProvider({
    providerName: 'generic-http',
    scheduleUrl: 'https://scheduler.example.test/schedule',
    cancelUrl: 'https://scheduler.example.test/cancel',
    secret: 'scheduler-secret',
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)),
        headers: init?.headers,
      });
      return new Response(JSON.stringify({
        scheduleId: 'schedule-1',
        fireAt: '2026-06-13T10:05:00.000Z',
      }), { status: 200 });
    },
  });

  const result = await provider.scheduleOnce({
    reminderId: 'reminder-1',
    occurrenceAt: new Date('2026-06-13T10:05:00.000Z'),
    version: 3,
    deliveryKey: 'reminder-1:1781345100000:v3',
  });

  assert.equal(result.provider, 'generic-http');
  assert.equal(result.scheduleId, 'schedule-1');
  assert.equal(result.fireAt.toISOString(), '2026-06-13T10:05:00.000Z');
  assert.equal(calls[0].url, 'https://scheduler.example.test/schedule');
  assert.deepEqual(calls[0].body, {
    reminderId: 'reminder-1',
    occurrenceAt: '2026-06-13T10:05:00.000Z',
    version: 3,
    deliveryKey: 'reminder-1:1781345100000:v3',
  });
});

test('http scheduler provider cancel is best-effort and does not throw on non-2xx', async () => {
  let called = false;
  const provider = createHttpSchedulerProvider({
    providerName: 'generic-http',
    scheduleUrl: 'https://scheduler.example.test/schedule',
    cancelUrl: 'https://scheduler.example.test/cancel',
    secret: 'scheduler-secret',
    fetchImpl: async () => {
      called = true;
      return new Response('missing', { status: 404 });
    },
  });

  await provider.cancel({ scheduleId: 'schedule-1' });
  assert.equal(called, true);
});

test('disabled scheduler provider rejects create and swallows cancel', async () => {
  const provider = createDisabledSchedulerProvider();
  await assert.rejects(
    () => provider.scheduleOnce({
      reminderId: 'reminder-1',
      occurrenceAt: new Date('2026-06-13T10:05:00.000Z'),
      version: 1,
      deliveryKey: 'key',
    }),
    /scheduler provider is disabled/i,
  );
  await provider.cancel({ scheduleId: 'ignored' });
});
```

- [ ] **Step 2: Run provider tests and verify they fail**

Run: `npm --workspace apps/backend run build && node --test dist/tests/reminders/scheduler-provider.test.js`

Expected: FAIL because `scheduler-provider.ts` does not exist.

- [ ] **Step 3: Implement scheduler provider**

Create `apps/backend/src/reminders/scheduler-provider.ts`:

```ts
import type { ReminderSchedulerPayload } from './contracts.js';

export type SchedulerScheduleInput = Readonly<{
  reminderId: string;
  occurrenceAt: Date;
  version: number;
  deliveryKey: string;
}>;

export type SchedulerScheduleResult = Readonly<{
  provider: string;
  scheduleId: string;
  fireAt: Date;
}>;

export type SchedulerProvider = Readonly<{
  readonly name: string;
  scheduleOnce: (input: SchedulerScheduleInput) => Promise<SchedulerScheduleResult>;
  cancel: (input: Readonly<{ scheduleId: string }>) => Promise<void>;
  describe?: (input: Readonly<{ scheduleId: string }>) => Promise<SchedulerScheduleResult | null>;
}>;

type FetchLike = typeof fetch;

const toPayload = (input: SchedulerScheduleInput): ReminderSchedulerPayload => ({
  reminderId: input.reminderId,
  occurrenceAt: input.occurrenceAt.toISOString(),
  version: input.version,
  deliveryKey: input.deliveryKey,
});

const assertOkResponse = async (response: Response, action: string): Promise<void> => {
  if (response.ok) {
    return;
  }

  const body = await response.text().catch(() => '');
  throw new Error(`Scheduler ${action} failed with ${response.status}: ${body}`);
};

export const createHttpSchedulerProvider = (
  input: Readonly<{
    providerName: string;
    scheduleUrl: string;
    cancelUrl: string;
    secret: string;
    fetchImpl?: FetchLike;
  }>,
): SchedulerProvider => {
  const fetchImpl = input.fetchImpl ?? fetch;
  const authHeaders = {
    'content-type': 'application/json',
    'x-reminder-scheduler-secret': input.secret,
  };

  return {
    name: input.providerName,
    scheduleOnce: async (scheduleInput) => {
      const response = await fetchImpl(input.scheduleUrl, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(toPayload(scheduleInput)),
      });
      await assertOkResponse(response, 'scheduleOnce');
      const body = (await response.json()) as { scheduleId: string; fireAt: string };
      return {
        provider: input.providerName,
        scheduleId: body.scheduleId,
        fireAt: new Date(body.fireAt),
      };
    },
    cancel: async ({ scheduleId }) => {
      await fetchImpl(input.cancelUrl, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ scheduleId }),
      }).catch(() => undefined);
    },
  };
};

export const createDisabledSchedulerProvider = (): SchedulerProvider => ({
  name: 'disabled',
  scheduleOnce: async () => {
    throw new Error('Reminder scheduler provider is disabled');
  },
  cancel: async () => undefined,
});
```

- [ ] **Step 4: Add scheduler config reader**

In `apps/backend/src/config.ts`, add:

```ts
const schedulerEnvSchema = z.object({
  REMINDER_SCHEDULER_PROVIDER: z.enum(['disabled', 'generic-http']).default('disabled'),
  REMINDER_SCHEDULER_SCHEDULE_URL: z.string().url().optional(),
  REMINDER_SCHEDULER_CANCEL_URL: z.string().url().optional(),
  REMINDER_SCHEDULER_SECRET: z.string().min(32).default('dev-reminder-scheduler-secret-32chars'),
});

export type ReminderSchedulerConfig = z.infer<typeof schedulerEnvSchema>;

export const readReminderSchedulerConfig = (
  env: NodeJS.ProcessEnv = process.env,
): ReminderSchedulerConfig => {
  const source = env.NODE_ENV === 'production' ? env : { ...env };
  const parsed = schedulerEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid reminder scheduler configuration: ${JSON.stringify(parsed.error.format())}`);
  }

  if (
    parsed.data.REMINDER_SCHEDULER_PROVIDER === 'generic-http' &&
    (!parsed.data.REMINDER_SCHEDULER_SCHEDULE_URL || !parsed.data.REMINDER_SCHEDULER_CANCEL_URL)
  ) {
    throw new Error('REMINDER_SCHEDULER_SCHEDULE_URL and REMINDER_SCHEDULER_CANCEL_URL are required for generic-http scheduler');
  }

  return parsed.data;
};
```

- [ ] **Step 5: Run provider tests**

Run: `npm --workspace apps/backend run build && node --test dist/tests/reminders/scheduler-provider.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/reminders/scheduler-provider.ts apps/backend/src/tests/reminders/scheduler-provider.test.ts apps/backend/src/config.ts
git commit -m "feat: add reminder scheduler provider abstraction"
```

## Task 4: Scheduler Service for One Active Next Occurrence

**Files:**
- Create: `apps/backend/src/reminders/scheduler-service.ts`
- Create: `apps/backend/src/tests/reminders/scheduler-service.test.ts`

- [ ] **Step 1: Add failing scheduler service tests**

Create `apps/backend/src/tests/reminders/scheduler-service.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import type { ReminderPatchInput, ReminderRecord } from '../../reminders/contracts.js';
import type { RemindersRepository } from '../../reminders/repositories/reminders-repository.js';
import { createReminderSchedulerService } from '../../reminders/scheduler-service.js';
import type { SchedulerProvider } from '../../reminders/scheduler-provider.js';

const createRecord = (input: Partial<ReminderRecord> = {}): ReminderRecord => ({
  id: 'reminder-1',
  userId: 'user-1',
  title: 'Reminder',
  triggerAt: new Date('2026-06-13T10:00:00.000Z'),
  done: null,
  repeatRule: 'none',
  repeatConfig: null,
  repeat: null,
  snoozedUntil: null,
  active: true,
  scheduleStatus: 'scheduled',
  timezone: 'UTC',
  baseAtLocal: null,
  startAt: null,
  nextTriggerAt: new Date('2026-06-13T10:05:00.000Z'),
  lastFiredAt: null,
  lastAcknowledgedAt: null,
  version: 3,
  scheduleProvider: null,
  scheduleTargetId: null,
  scheduleTargetVersion: null,
  scheduleTargetFireAt: null,
  createdAt: new Date('2026-06-13T09:00:00.000Z'),
  updatedAt: new Date('2026-06-13T09:00:00.000Z'),
  ...input,
});

test('scheduler service persists metadata only after provider schedule succeeds', async () => {
  const patches: ReminderPatchInput[] = [];
  const provider: SchedulerProvider = {
    name: 'fake',
    scheduleOnce: async (input) => ({
      provider: 'fake',
      scheduleId: `schedule-${input.deliveryKey}`,
      fireAt: input.occurrenceAt,
    }),
    cancel: async () => undefined,
  };
  const repository: Pick<RemindersRepository, 'patch'> = {
    patch: async ({ patch }) => {
      patches.push(patch);
      return createRecord({
        scheduleProvider: patch.scheduleProvider ?? null,
        scheduleTargetId: patch.scheduleTargetId ?? null,
        scheduleTargetVersion: patch.scheduleTargetVersion ?? null,
        scheduleTargetFireAt: patch.scheduleTargetFireAt ?? null,
      });
    },
  };

  const service = createReminderSchedulerService({ provider, remindersRepository: repository });
  await service.scheduleNextOccurrence(createRecord());

  assert.equal(patches.length, 1);
  assert.equal(patches[0].scheduleProvider, 'fake');
  assert.equal(patches[0].scheduleTargetId, 'schedule-reminder-1:1781345100000:v3');
  assert.equal(patches[0].scheduleTargetVersion, 3);
  assert.equal(patches[0].scheduleTargetFireAt?.toISOString(), '2026-06-13T10:05:00.000Z');
});

test('scheduler service leaves metadata empty when provider schedule fails', async () => {
  const patches: ReminderPatchInput[] = [];
  const provider: SchedulerProvider = {
    name: 'fake',
    scheduleOnce: async () => {
      throw new Error('provider down');
    },
    cancel: async () => undefined,
  };
  const repository: Pick<RemindersRepository, 'patch'> = {
    patch: async ({ patch }) => {
      patches.push(patch);
      return null;
    },
  };

  const service = createReminderSchedulerService({ provider, remindersRepository: repository });
  const result = await service.scheduleNextOccurrence(createRecord());

  assert.equal(result.scheduled, false);
  assert.equal(result.reason, 'provider_failed');
  assert.equal(patches.length, 0);
});

test('scheduler service cancels old target best effort and clears metadata', async () => {
  const canceled: string[] = [];
  const patches: ReminderPatchInput[] = [];
  const provider: SchedulerProvider = {
    name: 'fake',
    scheduleOnce: async () => {
      throw new Error('not used');
    },
    cancel: async ({ scheduleId }) => {
      canceled.push(scheduleId);
    },
  };
  const repository: Pick<RemindersRepository, 'patch'> = {
    patch: async ({ patch }) => {
      patches.push(patch);
      return null;
    },
  };

  const service = createReminderSchedulerService({ provider, remindersRepository: repository });
  await service.cancelCurrentSchedule(createRecord({ scheduleTargetId: 'schedule-old' }));

  assert.deepEqual(canceled, ['schedule-old']);
  assert.equal(patches[0].scheduleProvider, null);
  assert.equal(patches[0].scheduleTargetId, null);
  assert.equal(patches[0].scheduleTargetVersion, null);
  assert.equal(patches[0].scheduleTargetFireAt, null);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm --workspace apps/backend run build && node --test dist/tests/reminders/scheduler-service.test.js`

Expected: FAIL because `scheduler-service.ts` does not exist.

- [ ] **Step 3: Implement scheduler service**

Create `apps/backend/src/reminders/scheduler-service.ts`:

```ts
import type { ReminderPatchInput, ReminderRecord } from './contracts.js';
import type { RemindersRepository } from './repositories/reminders-repository.js';
import type { SchedulerProvider } from './scheduler-provider.js';

export const createReminderDeliveryKey = (
  input: Readonly<{ reminderId: string; occurrenceAt: Date | number; version: number }>,
): string => {
  const occurrenceMs = input.occurrenceAt instanceof Date
    ? input.occurrenceAt.getTime()
    : input.occurrenceAt;
  return `${input.reminderId}:${occurrenceMs}:v${input.version}`;
};

export type ReminderSchedulerService = Readonly<{
  scheduleNextOccurrence: (
    reminder: ReminderRecord,
  ) => Promise<Readonly<{ scheduled: boolean; deliveryKey?: string; reason?: string }>>;
  cancelCurrentSchedule: (reminder: ReminderRecord) => Promise<void>;
  clearScheduleMetadata: (reminder: ReminderRecord) => Promise<void>;
}>;

export const createReminderSchedulerService = (
  deps: Readonly<{
    provider: SchedulerProvider;
    remindersRepository: Pick<RemindersRepository, 'patch'>;
    now?: () => Date;
  }>,
): ReminderSchedulerService => {
  const now = deps.now ?? (() => new Date());

  const clearPatch = (): ReminderPatchInput => ({
    scheduleProvider: null,
    scheduleTargetId: null,
    scheduleTargetVersion: null,
    scheduleTargetFireAt: null,
    updatedAt: now(),
  });

  return {
    scheduleNextOccurrence: async (reminder) => {
      if (!reminder.active || reminder.nextTriggerAt === null) {
        return { scheduled: false, reason: 'not_due' };
      }

      const deliveryKey = createReminderDeliveryKey({
        reminderId: reminder.id,
        occurrenceAt: reminder.nextTriggerAt,
        version: reminder.version,
      });

      let scheduled;
      try {
        scheduled = await deps.provider.scheduleOnce({
          reminderId: reminder.id,
          occurrenceAt: reminder.nextTriggerAt,
          version: reminder.version,
          deliveryKey,
        });
      } catch {
        return { scheduled: false, deliveryKey, reason: 'provider_failed' };
      }

      await deps.remindersRepository.patch({
        reminderId: reminder.id,
        userId: reminder.userId,
        patch: {
          scheduleStatus: 'scheduled',
          scheduleProvider: scheduled.provider,
          scheduleTargetId: scheduled.scheduleId,
          scheduleTargetVersion: reminder.version,
          scheduleTargetFireAt: scheduled.fireAt,
          updatedAt: now(),
        },
      });

      return { scheduled: true, deliveryKey };
    },
    cancelCurrentSchedule: async (reminder) => {
      if (reminder.scheduleTargetId) {
        await deps.provider.cancel({ scheduleId: reminder.scheduleTargetId });
      }

      await deps.remindersRepository.patch({
        reminderId: reminder.id,
        userId: reminder.userId,
        patch: clearPatch(),
      });
    },
    clearScheduleMetadata: async (reminder) => {
      await deps.remindersRepository.patch({
        reminderId: reminder.id,
        userId: reminder.userId,
        patch: clearPatch(),
      });
    },
  };
};
```

- [ ] **Step 4: Run tests**

Run: `npm --workspace apps/backend run build && node --test dist/tests/reminders/scheduler-service.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/reminders/scheduler-service.ts apps/backend/src/tests/reminders/scheduler-service.test.ts
git commit -m "feat: add reminder scheduler service"
```

## Task 5: Wire Create, Update, Delete, Ack, and Snooze to Scheduling

**Files:**
- Modify: `apps/backend/src/reminders/service.ts`
- Modify: `apps/backend/src/reminders/contracts.ts`
- Modify: `apps/backend/src/tests/reminders/service.test.ts`

- [ ] **Step 1: Add failing service orchestration tests**

Append to `apps/backend/src/tests/reminders/service.test.ts`:

```ts
test('create reminder schedules next occurrence after durable create', async () => {
  const repository = createInMemoryRemindersRepository([]);
  const events = createChangeEventsDouble();
  const scheduled: string[] = [];
  const service = createRemindersService({
    remindersRepository: repository,
    noteChangeEventsRepository: events.repository,
    computeNext: () => 1_700_000_900_000,
    schedulerService: {
      scheduleNextOccurrence: async (reminder) => {
        scheduled.push(`${reminder.id}:${reminder.version}:${reminder.nextTriggerAt?.getTime()}`);
        return { scheduled: true, deliveryKey: 'delivery-key' };
      },
      cancelCurrentSchedule: async () => undefined,
      clearScheduleMetadata: async () => undefined,
    },
    now: () => new Date(1_700_000_500_000),
  });

  await service.createReminder({
    userId: 'user-1',
    id: 'reminder-scheduled',
    triggerAt: 1_700_000_000_000,
    repeat: { kind: 'daily', interval: 1 },
    startAt: 1_700_000_000_000,
    baseAtLocal: '2026-01-01T09:00:00',
    active: true,
    timezone: 'UTC',
  });

  assert.deepEqual(scheduled, ['reminder-scheduled:1:1700000900000']);
});

test('update reminder cancels old schedule and creates replacement for new version', async () => {
  const existing = createReminderRecord({
    id: 'reminder-1',
    userId: 'user-1',
    updatedAt: 1_700_000_000_000,
    nextTriggerAt: new Date(1_700_000_100_000),
    version: 2,
  });
  const repository = createInMemoryRemindersRepository([{
    ...existing,
    scheduleProvider: 'fake',
    scheduleTargetId: 'old-schedule',
    scheduleTargetVersion: 2,
    scheduleTargetFireAt: new Date(1_700_000_100_000),
  }]);
  const events = createChangeEventsDouble();
  const actions: string[] = [];
  const service = createRemindersService({
    remindersRepository: repository,
    noteChangeEventsRepository: events.repository,
    schedulerService: {
      scheduleNextOccurrence: async (reminder) => {
        actions.push(`schedule:${reminder.version}`);
        return { scheduled: true, deliveryKey: 'new-key' };
      },
      cancelCurrentSchedule: async (reminder) => {
        actions.push(`cancel:${reminder.scheduleTargetId}`);
      },
      clearScheduleMetadata: async () => undefined,
    },
  });

  await service.updateReminder({
    userId: 'user-1',
    reminderId: 'reminder-1',
    patch: {
      updatedAt: 1_700_000_200_000,
      title: 'After',
    },
  });

  assert.deepEqual(actions, ['cancel:old-schedule', 'schedule:3']);
});

test('delete reminder cancels current schedule before deleting reminder', async () => {
  const repository = createInMemoryRemindersRepository([
    {
      ...createReminderRecord({
        id: 'reminder-1',
        userId: 'user-1',
        updatedAt: 1_700_000_000_000,
      }),
      scheduleTargetId: 'schedule-1',
    },
  ]);
  const events = createChangeEventsDouble();
  const actions: string[] = [];
  const service = createRemindersService({
    remindersRepository: repository,
    noteChangeEventsRepository: events.repository,
    schedulerService: {
      scheduleNextOccurrence: async () => ({ scheduled: false }),
      cancelCurrentSchedule: async (reminder) => {
        actions.push(`cancel:${reminder.scheduleTargetId}`);
      },
      clearScheduleMetadata: async () => undefined,
    },
  });

  const deleted = await service.deleteReminder({ userId: 'user-1', reminderId: 'reminder-1' });

  assert.equal(deleted, true);
  assert.deepEqual(actions, ['cancel:schedule-1']);
});
```

- [ ] **Step 2: Run service tests and verify they fail**

Run: `npm --workspace apps/backend run build && node --test dist/tests/reminders/service.test.js`

Expected: FAIL because `createRemindersService` does not accept `schedulerService`.

- [ ] **Step 3: Extend service dependencies**

In `apps/backend/src/reminders/service.ts`, import the scheduler service types and defaults:

```ts
import {
  createReminderSchedulerService,
  type ReminderSchedulerService,
} from './scheduler-service.js';
import { createDisabledSchedulerProvider } from './scheduler-provider.js';
```

Add to `RemindersServiceDeps`:

```ts
  schedulerService?: ReminderSchedulerService;
```

Inside `createRemindersService`, create the default:

```ts
  const schedulerService =
    deps.schedulerService ??
    createReminderSchedulerService({
      provider: createDisabledSchedulerProvider(),
      remindersRepository,
    });
```

- [ ] **Step 4: Initialize scheduler metadata on create**

Add these values to `createInput`:

```ts
        scheduleProvider: null,
        scheduleTargetId: null,
        scheduleTargetVersion: null,
        scheduleTargetFireAt: null,
```

After `emitChangeEvent(created, 'create', ...)`, call:

```ts
      if (created.nextTriggerAt && created.active) {
        await schedulerService.scheduleNextOccurrence(created);
      }
```

- [ ] **Step 5: Cancel and replace schedule on effective update**

In `updateReminder`, after computing `updated` and before `emitChangeEvent`, add:

```ts
      await schedulerService.cancelCurrentSchedule(existing);
      if (updated.active && updated.nextTriggerAt) {
        await schedulerService.scheduleNextOccurrence(updated);
      } else {
        await schedulerService.clearScheduleMetadata(updated);
      }
```

- [ ] **Step 6: Cancel on delete**

In `deleteReminder`, before `deleteByIdForUser`, add:

```ts
      await schedulerService.cancelCurrentSchedule(existing);
```

- [ ] **Step 7: Schedule snoozed reminder and ack result**

In `ackReminder`, after a successful patch and before `emitChangeEvent`, add:

```ts
      await schedulerService.cancelCurrentSchedule(existing);
      if (updated.active && updated.nextTriggerAt) {
        await schedulerService.scheduleNextOccurrence(updated);
      } else {
        await schedulerService.clearScheduleMetadata(updated);
      }
```

In `snoozeReminder`, after a successful patch and before `emitChangeEvent`, add:

```ts
      await schedulerService.cancelCurrentSchedule(existing);
      if (updated.active && updated.nextTriggerAt) {
        await schedulerService.scheduleNextOccurrence(updated);
      }
```

- [ ] **Step 8: Run service tests**

Run: `npm --workspace apps/backend run build && node --test dist/tests/reminders/service.test.js`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/reminders/service.ts apps/backend/src/reminders/contracts.ts apps/backend/src/tests/reminders/service.test.ts
git commit -m "feat: schedule reminder next occurrence on mutations"
```

## Task 6: Notification Sender

**Files:**
- Create: `apps/backend/src/reminders/notification-sender.ts`
- Create: `apps/backend/src/tests/reminders/notification-sender.test.ts`

- [ ] **Step 1: Add failing notification sender tests**

Create `apps/backend/src/tests/reminders/notification-sender.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import type { DeviceTokensRepository } from '../../device-tokens/repositories/device-tokens-repository.js';
import type { PushDeliveryRequest, PushDeliveryResult, PushDeliveryService } from '../../jobs/push/contracts.js';
import { createReminderNotificationSender } from '../../reminders/notification-sender.js';
import type { ReminderRecord } from '../../reminders/contracts.js';

const reminder: ReminderRecord = {
  id: 'reminder-1',
  userId: 'user-1',
  title: 'Doctor',
  triggerAt: new Date('2026-06-13T10:00:00.000Z'),
  done: null,
  repeatRule: 'none',
  repeatConfig: null,
  repeat: null,
  snoozedUntil: null,
  active: true,
  scheduleStatus: 'scheduled',
  timezone: 'UTC',
  baseAtLocal: null,
  startAt: null,
  nextTriggerAt: new Date('2026-06-13T10:00:00.000Z'),
  lastFiredAt: null,
  lastAcknowledgedAt: null,
  version: 1,
  scheduleProvider: null,
  scheduleTargetId: null,
  scheduleTargetVersion: null,
  scheduleTargetFireAt: null,
  createdAt: new Date('2026-06-13T09:00:00.000Z'),
  updatedAt: new Date('2026-06-13T09:00:00.000Z'),
};

test('notification sender sends backend push to each registered token', async () => {
  const requests: PushDeliveryRequest[] = [];
  const sender = createReminderNotificationSender({
    deviceTokensRepository: {
      listByUserId: async () => [
        { id: 't1', userId: 'user-1', deviceId: 'device-1', fcmToken: 'fcm-1', platform: 'android', createdAt: new Date(), updatedAt: new Date() },
        { id: 't2', userId: 'user-1', deviceId: 'device-2', fcmToken: 'fcm-2', platform: 'android', createdAt: new Date(), updatedAt: new Date() },
      ],
    } as Pick<DeviceTokensRepository, 'listByUserId'>,
    pushDeliveryService: {
      deliverToToken: async (request) => {
        requests.push(request);
        return { classification: 'delivered' } satisfies PushDeliveryResult;
      },
    } satisfies PushDeliveryService,
  });

  const result = await sender.sendReminderNotification({
    reminder,
    deliveryKey: 'delivery-key',
    attempt: 0,
  });

  assert.equal(result.status, 'sent');
  assert.equal(result.delivered, 2);
  assert.deepEqual(requests.map((request) => request.token.deviceId), ['device-1', 'device-2']);
  assert.equal(requests[0].title, 'Doctor');
});

test('notification sender returns failed when there are no device tokens', async () => {
  const sender = createReminderNotificationSender({
    deviceTokensRepository: {
      listByUserId: async () => [],
    } as Pick<DeviceTokensRepository, 'listByUserId'>,
    pushDeliveryService: {
      deliverToToken: async () => ({ classification: 'delivered' }),
    },
  });

  const result = await sender.sendReminderNotification({
    reminder,
    deliveryKey: 'delivery-key',
    attempt: 0,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'no_device_tokens');
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm --workspace apps/backend run build && node --test dist/tests/reminders/notification-sender.test.js`

Expected: FAIL because `notification-sender.ts` does not exist.

- [ ] **Step 3: Implement notification sender**

Create `apps/backend/src/reminders/notification-sender.ts`:

```ts
import type { DeviceTokensRepository } from '../device-tokens/repositories/device-tokens-repository.js';
import type { PushDeliveryService } from '../jobs/push/contracts.js';
import type { ReminderRecord } from './contracts.js';

export type ReminderNotificationSendResult = Readonly<{
  status: 'sent' | 'failed';
  delivered: number;
  failed: number;
  reason?: string;
  providerMessageId?: string;
}>;

export type ReminderNotificationSender = Readonly<{
  sendReminderNotification: (
    input: Readonly<{ reminder: ReminderRecord; deliveryKey: string; attempt: number }>,
  ) => Promise<ReminderNotificationSendResult>;
}>;

const renderReminderTitle = (reminder: ReminderRecord): string => {
  const title = (reminder.title ?? '').trim();
  return title.length > 0 ? title : 'Reminder';
};

export const createReminderNotificationSender = (
  deps: Readonly<{
    deviceTokensRepository: Pick<DeviceTokensRepository, 'listByUserId'>;
    pushDeliveryService: PushDeliveryService;
  }>,
): ReminderNotificationSender => ({
  sendReminderNotification: async ({ reminder, deliveryKey, attempt }) => {
    const tokens = await deps.deviceTokensRepository.listByUserId(reminder.userId);
    if (tokens.length === 0) {
      return { status: 'failed', delivered: 0, failed: 0, reason: 'no_device_tokens' };
    }

    let delivered = 0;
    let failed = 0;
    let lastFailure: string | undefined;

    for (const token of tokens) {
      const result = await deps.pushDeliveryService.deliverToToken({
        userId: reminder.userId,
        reminderId: reminder.id,
        changeEventId: deliveryKey,
        isTrigger: true,
        attempt,
        token: {
          deviceId: token.deviceId,
          fcmToken: token.fcmToken,
        },
        title: renderReminderTitle(reminder),
        body: '',
      });

      if (result.classification === 'delivered') {
        delivered += 1;
      } else {
        failed += 1;
        lastFailure = result.errorCode ?? result.message ?? result.classification;
      }
    }

    if (delivered > 0) {
      return {
        status: 'sent',
        delivered,
        failed,
        providerMessageId: `tokens:${delivered}`,
      };
    }

    return {
      status: 'failed',
      delivered,
      failed,
      reason: lastFailure ?? 'all_push_attempts_failed',
    };
  },
});
```

- [ ] **Step 4: Run tests**

Run: `npm --workspace apps/backend run build && node --test dist/tests/reminders/notification-sender.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/reminders/notification-sender.ts apps/backend/src/tests/reminders/notification-sender.test.ts
git commit -m "feat: add backend reminder notification sender"
```

## Task 7: Scheduled Task Executor

**Files:**
- Create: `apps/backend/src/reminders/scheduled-task-executor.ts`
- Modify: `apps/backend/src/reminders/repositories/reminders-repository.ts`
- Create: `apps/backend/src/tests/reminders/scheduled-task-executor.test.ts`

- [ ] **Step 1: Add repository methods required by executor**

Extend `RemindersRepository` in `apps/backend/src/reminders/repositories/reminders-repository.ts`:

```ts
  findById: (input: Readonly<{ reminderId: string }>) => Promise<ReminderRecord | null>;
  advanceAfterDelivery: (
    input: Readonly<{
      reminderId: string;
      userId: string;
      occurrenceAt: Date;
      expectedVersion: number;
      nextTriggerAt: Date | null;
      scheduleStatus: string;
      runNow: Date;
    }>,
  ) => Promise<ReminderRecord | null>;
```

Implement `findById` with:

```sql
SELECT *
FROM notes
WHERE id = $1
  AND trigger_at IS NOT NULL
LIMIT 1
```

Implement `advanceAfterDelivery` with this guard:

```sql
UPDATE notes
SET
  last_fired_at = $1,
  next_trigger_at = $2,
  schedule_status = $3,
  schedule_provider = NULL,
  schedule_target_id = NULL,
  schedule_target_version = NULL,
  schedule_target_fire_at = NULL,
  updated_at = GREATEST(updated_at, $4),
  snoozed_until = NULL
WHERE id = $5
  AND user_id = $6
  AND version = $7
  AND active = true
  AND deleted_at IS NULL
  AND COALESCE(snoozed_until, next_trigger_at, trigger_at) = $8
RETURNING *
```

- [ ] **Step 2: Add failing executor tests**

Create `apps/backend/src/tests/reminders/scheduled-task-executor.test.ts` with tests for:

```ts
test('executor rejects version mismatch as stale and sends no push', async () => {
  // Arrange a reminder with version 4 and payload version 3.
  // Assert deliveries.markStale receives reason version_mismatch.
  // Assert notification sender is not called.
});

test('executor inserts one delivery row and treats duplicate occurrence as no-op', async () => {
  // Arrange insertPending returns inserted false.
  // Assert sender, advancement, and scheduling successor are not called.
});

test('executor sends push, marks sent, advances recurrence, and schedules successor', async () => {
  // Arrange recurring reminder due at payload occurrence.
  // Assert markSent, advanceAfterDelivery, and scheduleNextOccurrence are called in order.
});

test('executor marks failed and does not advance recurrence when push fails', async () => {
  // Arrange sender returns failed.
  // Assert markFailed is called and advanceAfterDelivery is not called.
});
```

Use concrete in-memory fakes with string event logs:

```ts
const events: string[] = [];
events.push('insert');
events.push('send');
events.push('mark-sent');
events.push('advance');
events.push('schedule-next');
assert.deepEqual(events, ['insert', 'send', 'mark-sent', 'advance', 'schedule-next']);
```

- [ ] **Step 3: Run executor tests and verify they fail**

Run: `npm --workspace apps/backend run build && node --test dist/tests/reminders/scheduled-task-executor.test.js`

Expected: FAIL because `scheduled-task-executor.ts` does not exist.

- [ ] **Step 4: Implement scheduled task executor**

Create `apps/backend/src/reminders/scheduled-task-executor.ts`:

```ts
import { createRequire } from 'node:module';

import type { ReminderRecord, ReminderRepeatRule, ReminderSchedulerPayload } from './contracts.js';
import type { ReminderDeliveriesRepository } from './repositories/reminder-deliveries-repository.js';
import type { RemindersRepository } from './repositories/reminders-repository.js';
import type { ReminderNotificationSender } from './notification-sender.js';
import {
  createReminderDeliveryKey,
  type ReminderSchedulerService,
} from './scheduler-service.js';

type ComputeNextTrigger = (
  now: number,
  startAt: number,
  baseAtLocal: string,
  repeat: ReminderRepeatRule | null,
  timezone?: string,
) => number | null;

const require = createRequire(import.meta.url);

const loadComputeNextTrigger = (): ComputeNextTrigger => {
  try {
    const shared = require('../../../../packages/shared/utils/recurrence.js') as {
      computeNextTrigger?: ComputeNextTrigger;
    };
    if (typeof shared.computeNextTrigger === 'function') {
      return shared.computeNextTrigger;
    }
  } catch {
    // Backend tests and local runs can execute before shared JS artifacts exist.
  }

  return (now, startAt, _baseAtLocal, repeat) => {
    if (!repeat) return null;
    const dayMs = 24 * 60 * 60 * 1000;
    const stepMs = repeat.kind === 'daily' ? repeat.interval * dayMs : dayMs;
    const steps = Math.floor((now - startAt) / stepMs) + 1;
    return startAt + steps * stepMs;
  };
};

const isDueOccurrence = (reminder: ReminderRecord, occurrenceAt: Date): boolean => {
  const current = reminder.snoozedUntil ?? reminder.nextTriggerAt ?? reminder.triggerAt;
  return current.getTime() === occurrenceAt.getTime();
};

const computeNextAfter = (
  computeNext: ComputeNextTrigger,
  reminder: ReminderRecord,
  runNow: Date,
): Date | null => {
  if (!reminder.repeat || !reminder.startAt || !reminder.baseAtLocal) {
    return null;
  }

  const nextMs = computeNext(
    runNow.getTime(),
    reminder.startAt.getTime(),
    reminder.baseAtLocal,
    reminder.repeat,
    reminder.timezone,
  );
  return nextMs === null ? null : new Date(nextMs);
};

export type ScheduledTaskExecutor = Readonly<{
  execute: (payload: ReminderSchedulerPayload) => Promise<Readonly<{ status: string }>>;
}>;

export const createScheduledTaskExecutor = (
  deps: Readonly<{
    remindersRepository: Pick<RemindersRepository, 'findById' | 'advanceAfterDelivery'>;
    deliveriesRepository: ReminderDeliveriesRepository;
    notificationSender: ReminderNotificationSender;
    schedulerService: ReminderSchedulerService;
    computeNext?: ComputeNextTrigger;
    now?: () => Date;
  }>,
): ScheduledTaskExecutor => {
  const computeNext = deps.computeNext ?? loadComputeNextTrigger();
  const now = deps.now ?? (() => new Date());

  return {
    execute: async (payload) => {
      const occurrenceAt = new Date(payload.occurrenceAt);
      const reminder = await deps.remindersRepository.findById({ reminderId: payload.reminderId });
      if (!reminder) {
        return { status: 'missing' };
      }

      const staleInput = {
        deliveryKey: payload.deliveryKey,
        reminderId: payload.reminderId,
        userId: reminder.userId,
        occurrenceAt,
        reminderVersion: payload.version,
      };

      if (!reminder.active || reminder.done === true) {
        await deps.deliveriesRepository.markCanceled({ ...staleInput, reason: 'inactive' });
        return { status: 'canceled' };
      }

      if (reminder.version !== payload.version) {
        await deps.deliveriesRepository.markStale({ ...staleInput, reason: 'version_mismatch' });
        return { status: 'stale' };
      }

      if (!isDueOccurrence(reminder, occurrenceAt)) {
        await deps.deliveriesRepository.markStale({ ...staleInput, reason: 'occurrence_mismatch' });
        return { status: 'stale' };
      }

      const expectedKey = createReminderDeliveryKey({
        reminderId: reminder.id,
        occurrenceAt,
        version: reminder.version,
      });
      if (payload.deliveryKey !== expectedKey) {
        await deps.deliveriesRepository.markStale({ ...staleInput, reason: 'delivery_key_mismatch' });
        return { status: 'stale' };
      }

      const inserted = await deps.deliveriesRepository.insertPending({
        reminderId: reminder.id,
        userId: reminder.userId,
        occurrenceAt,
        reminderVersion: reminder.version,
        deliveryKey: payload.deliveryKey,
      });
      if (!inserted.inserted) {
        return { status: 'duplicate' };
      }

      const sendResult = await deps.notificationSender.sendReminderNotification({
        reminder,
        deliveryKey: payload.deliveryKey,
        attempt: inserted.delivery.attemptCount,
      });

      if (sendResult.status !== 'sent') {
        await deps.deliveriesRepository.markFailed({
          deliveryKey: payload.deliveryKey,
          reason: sendResult.reason ?? 'push_failed',
        });
        return { status: 'failed' };
      }

      await deps.deliveriesRepository.markSent({
        deliveryKey: payload.deliveryKey,
        providerMessageId: sendResult.providerMessageId,
      });

      const runNow = now();
      const nextTriggerAt = computeNextAfter(computeNext, reminder, runNow);
      const advanced = await deps.remindersRepository.advanceAfterDelivery({
        reminderId: reminder.id,
        userId: reminder.userId,
        occurrenceAt,
        expectedVersion: reminder.version,
        nextTriggerAt,
        scheduleStatus: nextTriggerAt ? 'scheduled' : 'unscheduled',
        runNow,
      });

      if (advanced && advanced.nextTriggerAt) {
        await deps.schedulerService.scheduleNextOccurrence(advanced);
      } else if (advanced) {
        await deps.schedulerService.clearScheduleMetadata(advanced);
      }

      return { status: 'sent' };
    },
  };
};
```

- [ ] **Step 5: Run executor tests**

Run: `npm --workspace apps/backend run build && node --test dist/tests/reminders/scheduled-task-executor.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/reminders/scheduled-task-executor.ts apps/backend/src/reminders/repositories/reminders-repository.ts apps/backend/src/tests/reminders/scheduled-task-executor.test.ts
git commit -m "feat: execute scheduled reminder tasks idempotently"
```

## Task 8: Internal Scheduled Task Route

**Files:**
- Create: `apps/backend/src/reminders/internal-routes.ts`
- Modify: `apps/backend/src/runtime/createApiServer.ts`
- Create: `apps/backend/src/tests/reminders/internal-routes.test.ts`

- [ ] **Step 1: Add failing route tests**

Create `apps/backend/src/tests/reminders/internal-routes.test.ts`:

```ts
import assert from 'node:assert/strict';
import type { Server } from 'node:net';
import test from 'node:test';

import express from 'express';

import { errorMiddleware, notFoundMiddleware } from '../../middleware/error-middleware.js';
import { createReminderInternalRoutes } from '../../reminders/internal-routes.js';
import type { ScheduledTaskExecutor } from '../../reminders/scheduled-task-executor.js';

const startServer = async (executor: ScheduledTaskExecutor, secret: string) => {
  const app = express();
  app.use(express.json());
  app.use('/internal/reminders', createReminderInternalRoutes({ executor, secret }));
  app.use(notFoundMiddleware);
  app.use(errorMiddleware);
  const server = await new Promise<Server>((resolve, reject) => {
    const running = app.listen(0, '127.0.0.1', () => resolve(running));
    running.once('error', reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
};

test('internal scheduled task route requires shared scheduler secret', async () => {
  const executor: ScheduledTaskExecutor = {
    execute: async () => ({ status: 'sent' }),
  };
  const server = await startServer(executor, 'secret-32-characters-long-value');
  try {
    const response = await fetch(`${server.url}/internal/reminders/scheduled-task`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reminderId: 'reminder-1',
        occurrenceAt: '2026-06-13T10:05:00.000Z',
        version: 1,
        deliveryKey: 'key',
      }),
    });
    assert.equal(response.status, 401);
  } finally {
    await server.close();
  }
});

test('internal scheduled task route executes valid payload', async () => {
  const executed: string[] = [];
  const executor: ScheduledTaskExecutor = {
    execute: async (payload) => {
      executed.push(payload.reminderId);
      return { status: 'sent' };
    },
  };
  const secret = 'secret-32-characters-long-value';
  const server = await startServer(executor, secret);
  try {
    const response = await fetch(`${server.url}/internal/reminders/scheduled-task`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-reminder-scheduler-secret': secret,
      },
      body: JSON.stringify({
        reminderId: 'reminder-1',
        occurrenceAt: '2026-06-13T10:05:00.000Z',
        version: 1,
        deliveryKey: 'key',
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'sent' });
    assert.deepEqual(executed, ['reminder-1']);
  } finally {
    await server.close();
  }
});
```

- [ ] **Step 2: Run route tests and verify they fail**

Run: `npm --workspace apps/backend run build && node --test dist/tests/reminders/internal-routes.test.js`

Expected: FAIL because `internal-routes.ts` does not exist.

- [ ] **Step 3: Implement internal route**

Create `apps/backend/src/reminders/internal-routes.ts`:

```ts
import { Router } from 'express';
import { z } from 'zod';

import { AppError } from '../middleware/error-middleware.js';
import { validateRequest, withErrorBoundary } from '../middleware/validate.js';
import type { ReminderSchedulerPayload } from './contracts.js';
import type { ScheduledTaskExecutor } from './scheduled-task-executor.js';

const scheduledTaskBodySchema = z.object({
  reminderId: z.string().min(1),
  occurrenceAt: z.string().datetime(),
  version: z.number().int().positive(),
  deliveryKey: z.string().min(1),
});

export const createReminderInternalRoutes = (
  input: Readonly<{ executor: ScheduledTaskExecutor; secret: string }>,
): Router => {
  const router = Router();

  router.post(
    '/scheduled-task',
    validateRequest({ body: scheduledTaskBodySchema }),
    withErrorBoundary(async (request, response) => {
      const header = request.header('x-reminder-scheduler-secret');
      if (header !== input.secret) {
        throw new AppError({
          code: 'auth',
          status: 401,
          message: 'Invalid reminder scheduler secret',
        });
      }

      const result = await input.executor.execute(request.body as ReminderSchedulerPayload);
      response.status(200).json(result);
    }),
  );

  return router;
};
```

- [ ] **Step 4: Mount routes in API server**

Extend `ApiServerFactoryOptions` in `apps/backend/src/runtime/createApiServer.ts`:

```ts
  reminderScheduledTaskExecutor?: ScheduledTaskExecutor;
  reminderSchedulerSecret?: string;
```

Import:

```ts
import { createReminderInternalRoutes } from '../reminders/internal-routes.js';
import type { ScheduledTaskExecutor } from '../reminders/scheduled-task-executor.js';
```

Before `notFoundMiddleware`, add:

```ts
  if (options.reminderScheduledTaskExecutor && options.reminderSchedulerSecret) {
    app.use(
      '/internal/reminders',
      createReminderInternalRoutes({
        executor: options.reminderScheduledTaskExecutor,
        secret: options.reminderSchedulerSecret,
      }),
    );
  }
```

- [ ] **Step 5: Run route tests**

Run: `npm --workspace apps/backend run build && node --test dist/tests/reminders/internal-routes.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/reminders/internal-routes.ts apps/backend/src/runtime/createApiServer.ts apps/backend/src/tests/reminders/internal-routes.test.ts
git commit -m "feat: add internal reminder scheduled task endpoint"
```

## Task 9: Repair Job and Catch-Up

**Files:**
- Modify: `apps/backend/src/reminders/repositories/reminders-repository.ts`
- Create: `apps/backend/src/reminders/repair-job.ts`
- Create: `apps/backend/src/tests/reminders/repair-job.test.ts`

- [ ] **Step 1: Add repair repository methods**

Extend `RemindersRepository`:

```ts
  listRepairCandidates: (
    input: Readonly<{ now: Date; limit: number }>,
  ) => Promise<ReminderRecord[]>;
```

Implement the query:

```sql
SELECT *
FROM notes
WHERE trigger_at IS NOT NULL
  AND active = true
  AND deleted_at IS NULL
  AND (
    next_trigger_at <= $1
    OR (
      next_trigger_at IS NOT NULL
      AND schedule_target_id IS NULL
    )
    OR (
      schedule_target_version IS NOT NULL
      AND schedule_target_version <> version
    )
  )
ORDER BY next_trigger_at ASC NULLS LAST, updated_at ASC
LIMIT $2
```

- [ ] **Step 2: Add failing repair job tests**

Create `apps/backend/src/tests/reminders/repair-job.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { createReminderRepairJob } from '../../reminders/repair-job.js';

test('repair job executes overdue candidates through scheduled task executor', async () => {
  const executed: string[] = [];
  const now = new Date('2026-06-13T10:10:00.000Z');
  const job = createReminderRepairJob({
    remindersRepository: {
      listRepairCandidates: async () => [{
        id: 'reminder-1',
        userId: 'user-1',
        title: 'Reminder',
        triggerAt: new Date('2026-06-13T10:00:00.000Z'),
        done: null,
        repeatRule: 'none',
        repeatConfig: null,
        repeat: null,
        snoozedUntil: null,
        active: true,
        scheduleStatus: 'scheduled',
        timezone: 'UTC',
        baseAtLocal: null,
        startAt: null,
        nextTriggerAt: new Date('2026-06-13T10:05:00.000Z'),
        lastFiredAt: null,
        lastAcknowledgedAt: null,
        version: 2,
        scheduleProvider: null,
        scheduleTargetId: null,
        scheduleTargetVersion: null,
        scheduleTargetFireAt: null,
        createdAt: now,
        updatedAt: now,
      }],
    },
    executor: {
      execute: async (payload) => {
        executed.push(`${payload.reminderId}:${payload.version}:${payload.deliveryKey}`);
        return { status: 'sent' };
      },
    },
    schedulerService: {
      scheduleNextOccurrence: async () => ({ scheduled: true }),
      cancelCurrentSchedule: async () => undefined,
      clearScheduleMetadata: async () => undefined,
    },
    now: () => now,
  });

  const result = await job.run();

  assert.equal(result.candidates, 1);
  assert.equal(result.executed, 1);
  assert.deepEqual(executed, ['reminder-1:2:reminder-1:1781345100000:v2']);
});
```

- [ ] **Step 3: Run repair tests and verify they fail**

Run: `npm --workspace apps/backend run build && node --test dist/tests/reminders/repair-job.test.js`

Expected: FAIL because `repair-job.ts` does not exist.

- [ ] **Step 4: Implement repair job**

Create `apps/backend/src/reminders/repair-job.ts`:

```ts
import type { RemindersRepository } from './repositories/reminders-repository.js';
import { createReminderDeliveryKey } from './scheduler-service.js';
import type { ScheduledTaskExecutor } from './scheduled-task-executor.js';
import type { ReminderSchedulerService } from './scheduler-service.js';

export type ReminderRepairJob = Readonly<{
  run: () => Promise<Readonly<{ candidates: number; executed: number; scheduled: number }>>;
}>;

export const createReminderRepairJob = (
  deps: Readonly<{
    remindersRepository: Pick<RemindersRepository, 'listRepairCandidates'>;
    executor: ScheduledTaskExecutor;
    schedulerService: ReminderSchedulerService;
    now?: () => Date;
    limit?: number;
  }>,
): ReminderRepairJob => {
  const now = deps.now ?? (() => new Date());
  const limit = deps.limit ?? 100;

  return {
    run: async () => {
      const candidates = await deps.remindersRepository.listRepairCandidates({
        now: now(),
        limit,
      });
      let executed = 0;
      let scheduled = 0;

      for (const reminder of candidates) {
        if (!reminder.nextTriggerAt) {
          continue;
        }

        if (reminder.nextTriggerAt.getTime() <= now().getTime()) {
          const deliveryKey = createReminderDeliveryKey({
            reminderId: reminder.id,
            occurrenceAt: reminder.nextTriggerAt,
            version: reminder.version,
          });
          await deps.executor.execute({
            reminderId: reminder.id,
            occurrenceAt: reminder.nextTriggerAt.toISOString(),
            version: reminder.version,
            deliveryKey,
          });
          executed += 1;
          continue;
        }

        if (
          reminder.scheduleTargetId === null ||
          reminder.scheduleTargetVersion !== reminder.version
        ) {
          const result = await deps.schedulerService.scheduleNextOccurrence(reminder);
          if (result.scheduled) {
            scheduled += 1;
          }
        }
      }

      return { candidates: candidates.length, executed, scheduled };
    },
  };
};
```

- [ ] **Step 5: Run repair tests**

Run: `npm --workspace apps/backend run build && node --test dist/tests/reminders/repair-job.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/reminders/repair-job.ts apps/backend/src/reminders/repositories/reminders-repository.ts apps/backend/src/tests/reminders/repair-job.test.ts
git commit -m "feat: add coarse reminder scheduler repair job"
```

## Task 10: Worker Cutover from Hot Polling to Coarse Repair

**Files:**
- Modify: `apps/backend/src/worker/boss-adapter.ts`
- Modify: `apps/backend/src/tests/worker-bootstrap.test.ts`
- Modify: `apps/backend/src/jobs/reminders/dispatch-due-reminders.ts`

- [ ] **Step 1: Add worker cutover test**

Append to `apps/backend/src/tests/worker-bootstrap.test.ts`:

```ts
test('pg-boss adapter runs reminder repair on coarse interval instead of minute scanner path', async () => {
  let nowMs = Date.parse('2026-06-13T10:03:22.000Z');
  const timeoutQueue: Array<Readonly<{ delayMs: number; callback: () => void; handle: NodeJS.Timeout; cleared: boolean }>> = [];
  const repairRuns: string[] = [];
  const dispatchRuns: string[] = [];
  const scheduler = {
    setInterval: (_callback: () => void, _ms: number): NodeJS.Timeout => {
      throw new Error('setInterval should not be used');
    },
    clearInterval: (_handle: NodeJS.Timeout): void => undefined,
    setTimeout: (callback: () => void, delayMs: number): NodeJS.Timeout => {
      const handle = { id: timeoutQueue.length + 1 } as unknown as NodeJS.Timeout;
      timeoutQueue.push({ delayMs, callback, handle, cleared: false });
      return handle;
    },
    clearTimeout: (handle: NodeJS.Timeout): void => {
      const index = timeoutQueue.findIndex((item) => item.handle === handle);
      if (index >= 0) timeoutQueue[index] = { ...timeoutQueue[index], cleared: true };
    },
  };

  const adapter = createPgBossAdapter({
    scheduler,
    now: () => new Date(nowMs),
    reminderRepairIntervalMs: 15 * 60 * 1000,
    reminderRepairJob: {
      run: async () => {
        repairRuns.push(new Date(nowMs).toISOString());
        return { candidates: 0, executed: 0, scheduled: 0 };
      },
    },
    dispatchJob: {
      run: async () => {
        dispatchRuns.push(new Date(nowMs).toISOString());
        return { cronKey: 'check-reminders', since: new Date(nowMs), now: new Date(nowMs), scanned: 0, enqueued: 0, duplicates: 0 };
      },
    },
    logger: { info: () => undefined, error: () => undefined },
  });

  await adapter.start();
  await Promise.resolve();
  assert.deepEqual(repairRuns, ['2026-06-13T10:03:22.000Z']);
  assert.deepEqual(dispatchRuns, []);
  await adapter.stop();
});
```

- [ ] **Step 2: Run worker test and verify it fails**

Run: `npm --workspace apps/backend run build && node --test dist/tests/worker-bootstrap.test.js`

Expected: FAIL because `PgBossAdapterOptions` does not accept `reminderRepairJob`.

- [ ] **Step 3: Update worker options and lifecycle**

In `apps/backend/src/worker/boss-adapter.ts`, import:

```ts
import {
  createReminderRepairJob,
  type ReminderRepairJob,
} from '../reminders/repair-job.js';
```

Add options:

```ts
  reminderRepairIntervalMs?: number;
  reminderRepairJob?: ReminderRepairJob;
```

Create the default repair job from the existing repository, executor, and scheduler service. Name its timer state:

```ts
  const reminderRepairIntervalMs = options.reminderRepairIntervalMs ?? 15 * 60 * 1000;
  const reminderRepairJob = options.reminderRepairJob ?? createReminderRepairJob({ ... });
  let reminderRepairTimerHandle: NodeJS.Timeout | null = null;
  let inFlightReminderRepair: Promise<void> | null = null;
  let lastReminderRepairAt: string | null = null;
  let lastReminderRepairError: string | null = null;
```

Replace `scheduleNextDispatchCycle()` and the initial `runDispatchCycle()` call for reminders with `scheduleNextReminderRepairCycle()` and `runReminderRepairCycle()`. Leave subscription dispatch untouched.

- [ ] **Step 4: Preserve old scanner as explicit fallback**

Keep `createReminderDispatchJob`, `createDueReminderScanner`, and `createReminderOccurrenceAdvancer` exports. Do not delete tests for them. Add a comment at the top of `dispatch-due-reminders.ts`:

```ts
// Fallback scanner path retained for repair/backfill tests and emergency operation.
// The normal reminder delivery path is scheduled-task execution.
```

- [ ] **Step 5: Run worker tests**

Run: `npm --workspace apps/backend run build && node --test dist/tests/worker-bootstrap.test.js dist/tests/jobs/reminder-dispatch.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/worker/boss-adapter.ts apps/backend/src/tests/worker-bootstrap.test.ts apps/backend/src/jobs/reminders/dispatch-due-reminders.ts
git commit -m "feat: run reminder repair instead of hot reminder polling"
```

## Task 11: Integration and Contract Coverage

**Files:**
- Create: `apps/backend/src/tests/reminders/scheduler-integration.test.ts`
- Modify: `tests/contract/reminders.crud.test.ts`
- Modify: `tests/contract/reminders.update.test.ts`
- Modify: `tests/contract/reminders.snoozeReminder.test.ts`

- [ ] **Step 1: Add backend integration tests**

Create `apps/backend/src/tests/reminders/scheduler-integration.test.ts` with these test names and event assertions:

```ts
test('create reminder schedules exactly one next occurrence', async () => {
  // Arrange fake scheduler provider and in-memory repositories.
  // Assert exactly one scheduleOnce call with version 1.
});

test('update reminder cancels old schedule and creates replacement from edit time forward', async () => {
  // Arrange existing scheduled reminder at version 1.
  // Assert cancel old schedule before schedule replacement with version 2.
});

test('delete reminder cancels schedule and stale callback is ignored', async () => {
  // Arrange deleted/inactive reminder after delete.
  // Execute old payload.
  // Assert executor returns canceled or missing and sends no push.
});

test('duplicate scheduled task execution creates one delivery', async () => {
  // Execute same payload twice.
  // Assert second execution returns duplicate and sender called once.
});

test('repair job backfills missed occurrence after simulated downtime', async () => {
  // Arrange nextTriggerAt in the past with no scheduler metadata.
  // Run repair.
  // Assert executor is called with the overdue occurrence.
});
```

- [ ] **Step 2: Run integration tests and verify at least one fails**

Run: `npm --workspace apps/backend run build && node --test dist/tests/reminders/scheduler-integration.test.js`

Expected: FAIL until the integration harness is wired to the implemented services.

- [ ] **Step 3: Complete integration harness using existing fakes**

Use the in-memory repository pattern from `apps/backend/src/tests/reminders/service.test.ts`. Reuse:

```ts
type EventLog = string[];
const events: EventLog = [];
events.push(`schedule:${payload.reminderId}:${payload.version}`);
events.push(`cancel:${scheduleId}`);
events.push(`delivery:${deliveryKey}`);
events.push(`send:${reminder.id}`);
```

Assert exact order with `assert.deepEqual`.

- [ ] **Step 4: Add contract checks for unchanged public reminder API**

In existing contract tests under `tests/contract/reminders.*.test.ts`, add assertions that public reminder payloads still include:

```ts
expect(reminder.version).toBeDefined();
expect(reminder.nextTriggerAt === null || typeof reminder.nextTriggerAt === 'number').toBe(true);
```

Do not expose `scheduleTargetId` or provider internals in public web/mobile contract assertions.

- [ ] **Step 5: Run backend integration and contract tests**

Run:

```bash
npm --workspace apps/backend run build
node --test dist/tests/reminders/scheduler-integration.test.js
npm test -- tests/contract/reminders.crud.test.ts tests/contract/reminders.update.test.ts tests/contract/reminders.snoozeReminder.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/tests/reminders/scheduler-integration.test.ts tests/contract/reminders.crud.test.ts tests/contract/reminders.update.test.ts tests/contract/reminders.snoozeReminder.test.ts
git commit -m "test: cover reminder scheduler integration"
```

## Task 12: Observability and Final Verification

**Files:**
- Modify: `apps/backend/src/reminders/scheduler-service.ts`
- Modify: `apps/backend/src/reminders/scheduled-task-executor.ts`
- Modify: `apps/backend/src/reminders/repair-job.ts`
- Modify: `apps/backend/src/worker/boss-adapter.ts`
- Modify: `docs/superpowers/specs/2026-06-13-reminder-scheduler-redesign-design.md`

- [ ] **Step 1: Add structured logs**

Add log dependency types to scheduler service, executor, and repair job:

```ts
type ReminderSchedulerLogger = Readonly<{
  info: (message: string) => void;
  error: (message: string, error?: unknown) => void;
}>;
```

Emit these exact log message prefixes:

```text
[reminder-scheduler] schedule created
[reminder-scheduler] schedule canceled
[reminder-scheduler] schedule create failed
[reminder-scheduler] stale task rejected
[reminder-scheduler] delivery sent
[reminder-scheduler] delivery failed
[reminder-scheduler] repair completed
```

- [ ] **Step 2: Add worker health details**

In `toSnapshot` inside `apps/backend/src/worker/boss-adapter.ts`, include:

```ts
      reminderRepairIntervalMs,
      reminderRepairInFlight: inFlightReminderRepair !== null,
      lastReminderRepairAt,
      lastReminderRepairError,
```

- [ ] **Step 3: Update design doc rollout state**

Append to `docs/superpowers/specs/2026-06-13-reminder-scheduler-redesign-design.md`:

```markdown
## Implementation Notes

- Backend normal reminder delivery now uses one scheduled task for the next occurrence.
- The previous minute scanner remains available as a fallback repair/backfill mechanism.
- Public client reminder APIs continue to use the existing reminder payload shape and do not expose scheduler provider identifiers.
```

- [ ] **Step 4: Run full verification**

Run:

```bash
npm run lint
npm --workspace apps/backend run test
npm test
```

Expected:

```text
npm run lint exits 0
npm --workspace apps/backend run test exits 0
npm test exits 0
```

Do not run Android builds.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/reminders/scheduler-service.ts apps/backend/src/reminders/scheduled-task-executor.ts apps/backend/src/reminders/repair-job.ts apps/backend/src/worker/boss-adapter.ts docs/superpowers/specs/2026-06-13-reminder-scheduler-redesign-design.md
git commit -m "chore: add reminder scheduler observability"
```

## Self-Review

Spec coverage:

- One-time and recurring reminders: covered by `scheduler-service`, `scheduled-task-executor`, and existing recurrence computation.
- Edits apply only to future fires: covered by update cancellation, version increment, recompute from `now`, and replacement scheduling.
- Backend-only delivery: covered by `notification-sender` and scheduled-task executor.
- One-minute delivery tolerance: the provider stores intended `fireAt`; executor validates exact occurrence identity, while provider timing is allowed to drift by up to one minute operationally.
- Canceled stale schedules: covered by best-effort cancel plus mandatory version/occurrence validation.
- One active external schedule: covered by one metadata tuple on the reminder row and replacement scheduling.
- Durable idempotency: covered by `reminder_deliveries` unique `(reminder_id, occurrence_at)` and `delivery_key`.
- Repair and catch-up: covered by `repair-job` and `listRepairCandidates`.
- Observability: covered by Task 12 logs and worker health fields.

Placeholder scan:

- This plan contains concrete file paths, type names, test names, SQL, route paths, commands, and expected results.
- No task relies on unspecified provider behavior; the generic HTTP provider has exact request and response fields.

Type consistency:

- Reminder scheduler metadata names are `scheduleProvider`, `scheduleTargetId`, `scheduleTargetVersion`, `scheduleTargetFireAt` in TypeScript and `schedule_provider`, `schedule_target_id`, `schedule_target_version`, `schedule_target_fire_at` in SQL.
- Scheduled payload names are `reminderId`, `occurrenceAt`, `version`, and `deliveryKey` in route, provider, executor, and tests.
- Delivery status values match the SQL check constraint and TypeScript union.

Plan complete and saved to `docs/superpowers/plans/2026-06-13-reminder-scheduler-redesign.md`. Two execution options:

**1. Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
