# Reminder Scheduler QStash Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current `generic-http` reminder scheduler transport and shared-secret callback trust with Upstash QStash publishing, cancellation, and raw-body signature verification.

**Architecture:** Preserve the existing reminder scheduler domain model, delivery ledger, scheduler service, repair job, and scheduled-task executor. Swap the scheduler provider implementation to a QStash adapter that publishes the next reminder occurrence to `/internal/reminders/scheduled-task`, stores the returned QStash message id, cancels stale message ids best-effort, and verifies inbound callbacks with QStash signing keys before JSON parsing. Keep `disabled` mode as the rollback path.

**Tech Stack:** TypeScript, Node.js, Express, PostgreSQL-backed reminder scheduler, `@upstash/qstash`, `node:test`.

---

## File Structure

- Modify: `apps/backend/package.json`
  - Add `@upstash/qstash` as the QStash SDK dependency.
- Modify: `package-lock.json`
  - Capture the installed QStash SDK dependency graph.
- Modify: `apps/backend/src/config.ts`
  - Replace `generic-http` scheduler config with `qstash` config while preserving `disabled`.
- Modify: `apps/backend/src/reminders/scheduler-provider.ts`
  - Replace `createHttpSchedulerProvider` with `createQstashSchedulerProvider`; keep `createDisabledSchedulerProvider`.
- Modify: `apps/backend/src/reminders/runtime.ts`
  - Build the QStash provider from config, derive the callback URL, and expose QStash verifier config instead of a shared secret.
- Modify: `apps/backend/src/reminders/internal-routes.ts`
  - Verify `Upstash-Signature` against the exact raw request body and exact callback URL before validating JSON.
- Modify: `apps/backend/src/runtime/createApiServer.ts`
  - Capture raw JSON request bodies and pass QStash verifier options into internal reminder routes.
- Modify: `apps/backend/src/runtime/startApi.ts`
  - Mount callbacks when QStash mode is enabled and pass verifier options.
- Modify: `apps/backend/src/worker/boss-adapter.ts`
  - Treat `qstash` as the scheduler-enabled mode for coarse repair.
- Modify tests:
  - `apps/backend/src/tests/auth/tokens.test.ts`
  - `apps/backend/src/tests/reminders/scheduler-provider.test.ts`
  - `apps/backend/src/tests/reminders/internal-routes.test.ts`
  - `apps/backend/src/tests/reminders/runtime.test.ts`
  - `apps/backend/src/tests/worker-bootstrap.test.ts`

## External Contract Notes

- Upstash QStash TypeScript SDK supports `Client.publishJSON({ url, body, delay })` and returns a response with `messageId`.
- Upstash QStash TypeScript SDK supports `client.messages.cancel(messageId)` for messages still pending delivery or retry.
- Upstash QStash sends `Upstash-Signature`; `Receiver.verify({ body, signature, url })` must receive the raw request body string, not a re-serialized parsed object.
- The callback URL must be exactly `new URL('/internal/reminders/scheduled-task', REMINDER_SCHEDULER_CALLBACK_BASE_URL).toString()`.

## Shared Names

Use these exact names throughout the cutover:

```ts
export type QstashVerifierConfig = Readonly<{
  currentSigningKey: string;
  nextSigningKey: string;
  callbackUrl: string;
}>;

export type RawBodyRequest = Request & Readonly<{ rawBody?: string }>;

export const REMINDER_QSTASH_PROVIDER = 'qstash' as const;
```

## Task 1: QStash Configuration and Dependency

**Files:**
- Modify: `apps/backend/package.json`
- Modify: `package-lock.json`
- Modify: `apps/backend/src/config.ts`
- Modify: `apps/backend/src/tests/auth/tokens.test.ts`

- [ ] **Step 1: Install the QStash SDK**

Run:

```bash
npm install --workspace apps/backend @upstash/qstash@^2.11.1
```

Expected: `apps/backend/package.json` and `package-lock.json` change, and `@upstash/qstash` appears under backend dependencies.

- [ ] **Step 2: Replace scheduler config tests**

In `apps/backend/src/tests/auth/tokens.test.ts`, replace the generic HTTP scheduler tests with:

```ts
test('production scheduler config requires QStash credentials for qstash provider', () => {
  assert.throws(
    () =>
      readReminderSchedulerConfig({
        NODE_ENV: 'production',
        REMINDER_SCHEDULER_PROVIDER: 'qstash',
        REMINDER_SCHEDULER_CALLBACK_BASE_URL: 'https://api.example.test',
        QSTASH_TOKEN: 'qstash-token',
        QSTASH_CURRENT_SIGNING_KEY: 'current-signing-key',
      } as NodeJS.ProcessEnv),
    /QSTASH_NEXT_SIGNING_KEY is required/i,
  );
});

test('qstash scheduler config accepts callback base url token and signing keys', () => {
  const config = readReminderSchedulerConfig({
    NODE_ENV: 'production',
    REMINDER_SCHEDULER_PROVIDER: 'qstash',
    REMINDER_SCHEDULER_CALLBACK_BASE_URL: 'https://api.example.test',
    QSTASH_TOKEN: 'qstash-token',
    QSTASH_CURRENT_SIGNING_KEY: 'current-signing-key',
    QSTASH_NEXT_SIGNING_KEY: 'next-signing-key',
  } as NodeJS.ProcessEnv);

  assert.equal(config.REMINDER_SCHEDULER_PROVIDER, 'qstash');
  assert.equal(config.REMINDER_SCHEDULER_CALLBACK_BASE_URL, 'https://api.example.test');
  assert.equal(config.QSTASH_TOKEN, 'qstash-token');
  assert.equal(config.QSTASH_CURRENT_SIGNING_KEY, 'current-signing-key');
  assert.equal(config.QSTASH_NEXT_SIGNING_KEY, 'next-signing-key');
});

test('development scheduler config still defaults disabled provider metadata safely', () => {
  const config = readReminderSchedulerConfig({
    NODE_ENV: 'development',
  } as NodeJS.ProcessEnv) as ReminderSchedulerConfig;

  assert.equal(config.REMINDER_SCHEDULER_PROVIDER, 'disabled');
});
```

- [ ] **Step 3: Run config tests and verify they fail**

Run:

```bash
npm --workspace apps/backend run build
node --test dist/tests/auth/tokens.test.js
```

Expected: FAIL because `REMINDER_SCHEDULER_PROVIDER` does not accept `qstash` and the QStash env fields are not in `ReminderSchedulerConfig`.

- [ ] **Step 4: Replace scheduler config schema**

In `apps/backend/src/config.ts`, replace `schedulerEnvSchema` and `readReminderSchedulerConfig` with:

```ts
const schedulerEnvSchema = z.object({
  REMINDER_SCHEDULER_PROVIDER: z.enum(['disabled', 'qstash']).default('disabled'),
  REMINDER_SCHEDULER_CALLBACK_BASE_URL: z.string().url().optional(),
  QSTASH_TOKEN: z.string().min(1).optional(),
  QSTASH_CURRENT_SIGNING_KEY: z.string().min(1).optional(),
  QSTASH_NEXT_SIGNING_KEY: z.string().min(1).optional(),
  QSTASH_URL: z.string().url().optional(),
});

type CoreConfig = z.infer<typeof envSchema>;
export type AuthConfig = z.infer<typeof authEnvSchema>;
export type ReminderSchedulerConfig = z.infer<typeof schedulerEnvSchema>;
```

Replace the provider-specific validation inside `readReminderSchedulerConfig` with:

```ts
  if (parsed.data.REMINDER_SCHEDULER_PROVIDER === 'qstash') {
    if (!parsed.data.REMINDER_SCHEDULER_CALLBACK_BASE_URL) {
      throw new Error('REMINDER_SCHEDULER_CALLBACK_BASE_URL is required for qstash scheduler');
    }

    if (!parsed.data.QSTASH_TOKEN) {
      throw new Error('QSTASH_TOKEN is required for qstash scheduler');
    }

    if (!parsed.data.QSTASH_CURRENT_SIGNING_KEY) {
      throw new Error('QSTASH_CURRENT_SIGNING_KEY is required for qstash scheduler');
    }

    if (!parsed.data.QSTASH_NEXT_SIGNING_KEY) {
      throw new Error('QSTASH_NEXT_SIGNING_KEY is required for qstash scheduler');
    }
  }
```

- [ ] **Step 5: Run config tests**

Run:

```bash
npm --workspace apps/backend run build
node --test dist/tests/auth/tokens.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/package.json package-lock.json apps/backend/src/config.ts apps/backend/src/tests/auth/tokens.test.ts
git commit -m "feat: configure qstash reminder scheduler"
```

## Task 2: QStash Scheduler Provider

**Files:**
- Modify: `apps/backend/src/reminders/scheduler-provider.ts`
- Modify: `apps/backend/src/tests/reminders/scheduler-provider.test.ts`

- [ ] **Step 1: Replace provider tests with QStash behavior**

Replace `apps/backend/src/tests/reminders/scheduler-provider.test.ts` with:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDisabledSchedulerProvider,
  createQstashSchedulerProvider,
  type QstashClientLike,
} from '../../reminders/scheduler-provider.js';

test('qstash scheduler provider publishes schedule payload and returns message metadata', async () => {
  const publishCalls: unknown[] = [];
  const client: QstashClientLike = {
    publishJSON: async (input) => {
      publishCalls.push(input);
      return { messageId: 'msg_123' };
    },
    messages: {
      cancel: async () => undefined,
    },
  };
  const provider = createQstashSchedulerProvider({
    client,
    callbackUrl: 'https://api.example.test/internal/reminders/scheduled-task',
    now: () => new Date('2026-06-13T10:00:00.000Z'),
  });

  const result = await provider.scheduleOnce({
    reminderId: 'reminder-1',
    occurrenceAt: new Date('2026-06-13T10:05:00.000Z'),
    version: 3,
    deliveryKey: 'reminder-1:1781345100000:v3',
  });

  assert.equal(result.provider, 'qstash');
  assert.equal(result.scheduleId, 'msg_123');
  assert.equal(result.fireAt.toISOString(), '2026-06-13T10:05:00.000Z');
  assert.deepEqual(publishCalls, [
    {
      url: 'https://api.example.test/internal/reminders/scheduled-task',
      body: {
        reminderId: 'reminder-1',
        occurrenceAt: '2026-06-13T10:05:00.000Z',
        version: 3,
        deliveryKey: 'reminder-1:1781345100000:v3',
      },
      delay: 300,
    },
  ]);
});

test('qstash scheduler provider clamps overdue schedules to immediate publish', async () => {
  const publishCalls: unknown[] = [];
  const client: QstashClientLike = {
    publishJSON: async (input) => {
      publishCalls.push(input);
      return { messageId: 'msg_now' };
    },
    messages: {
      cancel: async () => undefined,
    },
  };
  const provider = createQstashSchedulerProvider({
    client,
    callbackUrl: 'https://api.example.test/internal/reminders/scheduled-task',
    now: () => new Date('2026-06-13T10:05:01.000Z'),
  });

  await provider.scheduleOnce({
    reminderId: 'reminder-1',
    occurrenceAt: new Date('2026-06-13T10:05:00.000Z'),
    version: 1,
    deliveryKey: 'key',
  });

  assert.equal((publishCalls[0] as { delay: number }).delay, 0);
});

test('qstash scheduler provider cancel is best-effort and swallows missing messages', async () => {
  const canceled: string[] = [];
  const client: QstashClientLike = {
    publishJSON: async () => ({ messageId: 'msg_123' }),
    messages: {
      cancel: async (messageId) => {
        canceled.push(messageId);
        throw new Error('not found');
      },
    },
  };
  const provider = createQstashSchedulerProvider({
    client,
    callbackUrl: 'https://api.example.test/internal/reminders/scheduled-task',
  });

  await provider.cancel({ scheduleId: 'msg_123' });
  assert.deepEqual(canceled, ['msg_123']);
});

test('disabled scheduler provider rejects create and swallows cancel', async () => {
  const provider = createDisabledSchedulerProvider();
  await assert.rejects(
    () =>
      provider.scheduleOnce({
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

Run:

```bash
npm --workspace apps/backend run build
node --test dist/tests/reminders/scheduler-provider.test.js
```

Expected: FAIL because `createQstashSchedulerProvider` and `QstashClientLike` do not exist.

- [ ] **Step 3: Replace HTTP provider with QStash provider**

In `apps/backend/src/reminders/scheduler-provider.ts`, replace the `createHttpSchedulerProvider` implementation with:

```ts
import { Client } from '@upstash/qstash';

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
  describe?: (
    input: Readonly<{ scheduleId: string }>,
  ) => Promise<SchedulerScheduleResult | null>;
}>;

export type QstashClientLike = Readonly<{
  publishJSON: (
    input: Readonly<{
      url: string;
      body: ReminderSchedulerPayload;
      delay: number;
    }>,
  ) => Promise<Readonly<{ messageId: string }>>;
  messages: Readonly<{
    cancel: (messageId: string) => Promise<unknown>;
  }>;
}>;

const toPayload = (input: SchedulerScheduleInput): ReminderSchedulerPayload => ({
  reminderId: input.reminderId,
  occurrenceAt: input.occurrenceAt.toISOString(),
  version: input.version,
  deliveryKey: input.deliveryKey,
});

const secondsUntil = (fireAt: Date, now: Date): number => {
  return Math.max(0, Math.ceil((fireAt.getTime() - now.getTime()) / 1000));
};

export const createQstashClient = (
  input: Readonly<{ token: string; baseUrl?: string }>,
): QstashClientLike => {
  return new Client({
    token: input.token,
    baseUrl: input.baseUrl,
  }) as QstashClientLike;
};

export const createQstashSchedulerProvider = (
  input: Readonly<{
    client: QstashClientLike;
    callbackUrl: string;
    now?: () => Date;
  }>,
): SchedulerProvider => {
  const now = input.now ?? (() => new Date());

  return {
    name: 'qstash',
    scheduleOnce: async (scheduleInput) => {
      const response = await input.client.publishJSON({
        url: input.callbackUrl,
        body: toPayload(scheduleInput),
        delay: secondsUntil(scheduleInput.occurrenceAt, now()),
      });

      return {
        provider: 'qstash',
        scheduleId: response.messageId,
        fireAt: scheduleInput.occurrenceAt,
      };
    },
    cancel: async ({ scheduleId }) => {
      await input.client.messages.cancel(scheduleId).catch(() => undefined);
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

- [ ] **Step 4: Run provider tests**

Run:

```bash
npm --workspace apps/backend run build
node --test dist/tests/reminders/scheduler-provider.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/reminders/scheduler-provider.ts apps/backend/src/tests/reminders/scheduler-provider.test.ts
git commit -m "feat: add qstash reminder scheduler provider"
```

## Task 3: Runtime Wiring

**Files:**
- Modify: `apps/backend/src/reminders/runtime.ts`
- Modify: `apps/backend/src/runtime/startApi.ts`
- Modify: `apps/backend/src/worker/boss-adapter.ts`
- Modify: `apps/backend/src/tests/reminders/runtime.test.ts`
- Modify: `apps/backend/src/tests/worker-bootstrap.test.ts`

- [ ] **Step 1: Replace runtime test with QStash wiring**

In `apps/backend/src/tests/reminders/runtime.test.ts`, replace the current generic HTTP test body with:

```ts
test('runtime enables qstash scheduler for reminder writes and exposes verifier config', async () => {
  const reminders = new Map<string, ReminderRecord>();
  const remindersRepository: RemindersRepository = {
    listByUser: async () => [],
    listRepairCandidates: async () => [],
    findById: async ({ reminderId }) => {
      for (const reminder of reminders.values()) {
        if (reminder.id === reminderId) return reminder;
      }
      return null;
    },
    findByIdForUser: async ({ reminderId, userId }) => reminders.get(`${userId}:${reminderId}`) ?? null,
    create: async (input: ReminderCreateInput) => {
      const reminder = createReminderRecord(input);
      reminders.set(`${reminder.userId}:${reminder.id}`, reminder);
      return reminder;
    },
    patch: async ({ reminderId, userId, patch }) => {
      const existing = reminders.get(`${userId}:${reminderId}`);
      if (!existing) return null;
      const next: ReminderRecord = {
        ...existing,
        ...(Object.hasOwn(patch, 'scheduleStatus') ? { scheduleStatus: patch.scheduleStatus ?? existing.scheduleStatus } : {}),
        ...(Object.hasOwn(patch, 'scheduleProvider') ? { scheduleProvider: patch.scheduleProvider ?? null } : {}),
        ...(Object.hasOwn(patch, 'scheduleTargetId') ? { scheduleTargetId: patch.scheduleTargetId ?? null } : {}),
        ...(Object.hasOwn(patch, 'scheduleTargetVersion') ? { scheduleTargetVersion: patch.scheduleTargetVersion ?? null } : {}),
        ...(Object.hasOwn(patch, 'scheduleTargetFireAt') ? { scheduleTargetFireAt: patch.scheduleTargetFireAt ?? null } : {}),
        ...(Object.hasOwn(patch, 'updatedAt') ? { updatedAt: patch.updatedAt ?? existing.updatedAt } : {}),
      };
      reminders.set(`${userId}:${reminderId}`, next);
      return next;
    },
    advanceAfterDelivery: async () => {
      throw new Error('advanceAfterDelivery should not run in runtime wiring test');
    },
    deleteByIdForUser: async () => false,
  };
  const noteChangeEventsRepository: NoteChangeEventsRepository = {
    isDuplicate: async () => false,
    appendEvent: async () => undefined,
  };
  const publishCalls: unknown[] = [];
  const runtime = createReminderSchedulerRuntime({
    remindersRepository,
    noteChangeEventsRepository,
    schedulerConfig: {
      REMINDER_SCHEDULER_PROVIDER: 'qstash',
      REMINDER_SCHEDULER_CALLBACK_BASE_URL: 'https://api.example.test',
      QSTASH_TOKEN: 'qstash-token',
      QSTASH_CURRENT_SIGNING_KEY: 'current-signing-key',
      QSTASH_NEXT_SIGNING_KEY: 'next-signing-key',
    },
    qstashClient: {
      publishJSON: async (input) => {
        publishCalls.push(input);
        return { messageId: 'msg_123' };
      },
      messages: {
        cancel: async () => undefined,
      },
    },
    now: () => new Date('2026-06-13T09:00:00.000Z'),
  });

  await runtime.remindersService.createReminder({
    userId: 'user-1',
    id: 'reminder-1',
    title: 'Recurring reminder',
    triggerAt: Date.parse('2026-06-13T10:05:00.000Z'),
    active: true,
    timezone: 'UTC',
    repeat: { kind: 'daily', interval: 1 },
    startAt: Date.parse('2026-06-13T10:05:00.000Z'),
    baseAtLocal: '2026-06-13T10:05:00',
  });

  assert.equal(runtime.schedulerCallbacksEnabled, true);
  assert.deepEqual(runtime.qstashVerifierConfig, {
    currentSigningKey: 'current-signing-key',
    nextSigningKey: 'next-signing-key',
    callbackUrl: 'https://api.example.test/internal/reminders/scheduled-task',
  });
  assert.deepEqual(publishCalls, [
    {
      url: 'https://api.example.test/internal/reminders/scheduled-task',
      body: {
        reminderId: 'reminder-1',
        occurrenceAt: '2026-06-13T10:05:00.000Z',
        version: 1,
        deliveryKey: 'reminder-1:1781345100000:v1',
      },
      delay: 3900,
    },
  ]);
});
```

- [ ] **Step 2: Update worker tests to use QStash env**

In `apps/backend/src/tests/worker-bootstrap.test.ts`, rename `withGenericHttpSchedulerEnv` to `withQstashSchedulerEnv` and replace its environment assignments with:

```ts
  const originalProvider = process.env.REMINDER_SCHEDULER_PROVIDER;
  const originalCallbackBaseUrl = process.env.REMINDER_SCHEDULER_CALLBACK_BASE_URL;
  const originalToken = process.env.QSTASH_TOKEN;
  const originalCurrentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const originalNextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;

  process.env.REMINDER_SCHEDULER_PROVIDER = 'qstash';
  process.env.REMINDER_SCHEDULER_CALLBACK_BASE_URL = 'https://api.example.test';
  process.env.QSTASH_TOKEN = 'qstash-token';
  process.env.QSTASH_CURRENT_SIGNING_KEY = 'current-signing-key';
  process.env.QSTASH_NEXT_SIGNING_KEY = 'next-signing-key';
```

Update every helper cleanup branch to restore or delete those same five variables. Replace test names containing `generic-http` with `qstash`, and replace direct inline generic HTTP env setup in `pg-boss adapter runs reminder repair on coarse interval when generic-http scheduler is enabled` with the same QStash variables.

- [ ] **Step 3: Run runtime and worker tests and verify they fail**

Run:

```bash
npm --workspace apps/backend run build
node --test dist/tests/reminders/runtime.test.js dist/tests/worker-bootstrap.test.js
```

Expected: FAIL because runtime still imports `createHttpSchedulerProvider`, runtime does not accept `qstashClient`, and worker mode checks still reference old scheduler config.

- [ ] **Step 4: Update runtime types and provider creation**

In `apps/backend/src/reminders/runtime.ts`, replace the scheduler provider imports with:

```ts
import {
  createDisabledSchedulerProvider,
  createQstashClient,
  createQstashSchedulerProvider,
  type QstashClientLike,
  type SchedulerProvider,
} from './scheduler-provider.js';
```

Add:

```ts
export type QstashVerifierConfig = Readonly<{
  currentSigningKey: string;
  nextSigningKey: string;
  callbackUrl: string;
}>;
```

Change `ReminderSchedulerRuntime` to expose:

```ts
  qstashVerifierConfig: QstashVerifierConfig | null;
```

Remove `schedulerSecret`.

Add this helper:

```ts
export const createReminderSchedulerCallbackUrl = (baseUrl: string): string => {
  return new URL('/internal/reminders/scheduled-task', baseUrl).toString();
};
```

Change `createReminderSchedulerProvider` input to include `qstashClient?: QstashClientLike` and `now?: () => Date`, and replace provider creation with:

```ts
  if (schedulerConfig.REMINDER_SCHEDULER_PROVIDER === 'disabled') {
    return createDisabledSchedulerProvider();
  }

  const callbackBaseUrl = schedulerConfig.REMINDER_SCHEDULER_CALLBACK_BASE_URL;
  const token = schedulerConfig.QSTASH_TOKEN;
  if (!callbackBaseUrl || !token) {
    throw new Error('QStash scheduler requires callback base url and token');
  }

  return createQstashSchedulerProvider({
    client:
      input.qstashClient ??
      createQstashClient({
        token,
        baseUrl: schedulerConfig.QSTASH_URL,
      }),
    callbackUrl: createReminderSchedulerCallbackUrl(callbackBaseUrl),
    now: input.now,
  });
```

Add `qstashClient?: QstashClientLike` to `createReminderSchedulerRuntime` input and pass it into `createReminderSchedulerProvider`.

Use this provider creation call inside `createReminderSchedulerRuntime`:

```ts
  const schedulerProvider =
    input.schedulerProvider ??
    createReminderSchedulerProvider({
      schedulerConfig,
      qstashClient: input.qstashClient,
      now: input.now,
    });
```

Set verifier config at the end of runtime creation:

```ts
  const schedulerCallbacksEnabled = schedulerConfig.REMINDER_SCHEDULER_PROVIDER === 'qstash';
  const qstashVerifierConfig =
    schedulerCallbacksEnabled &&
    schedulerConfig.REMINDER_SCHEDULER_CALLBACK_BASE_URL &&
    schedulerConfig.QSTASH_CURRENT_SIGNING_KEY &&
    schedulerConfig.QSTASH_NEXT_SIGNING_KEY
      ? {
          currentSigningKey: schedulerConfig.QSTASH_CURRENT_SIGNING_KEY,
          nextSigningKey: schedulerConfig.QSTASH_NEXT_SIGNING_KEY,
          callbackUrl: createReminderSchedulerCallbackUrl(
            schedulerConfig.REMINDER_SCHEDULER_CALLBACK_BASE_URL,
          ),
        }
      : null;
```

Return `qstashVerifierConfig`.

- [ ] **Step 5: Update API startup wiring**

In `apps/backend/src/runtime/startApi.ts`, replace `reminderSchedulerSecret` wiring with:

```ts
    reminderQstashVerifierConfig: reminderRuntime.schedulerCallbacksEnabled
      ? reminderRuntime.qstashVerifierConfig ?? undefined
      : undefined,
```

- [ ] **Step 6: Update worker scheduler-enabled mode**

In `apps/backend/src/worker/boss-adapter.ts`, replace scheduler-enabled checks that compare `REMINDER_SCHEDULER_PROVIDER` to `generic-http` with:

```ts
readReminderSchedulerConfig().REMINDER_SCHEDULER_PROVIDER === 'qstash'
```

Keep `disabled` as legacy dispatch mode.

- [ ] **Step 7: Run runtime and worker tests**

Run:

```bash
npm --workspace apps/backend run build
node --test dist/tests/reminders/runtime.test.js dist/tests/worker-bootstrap.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/reminders/runtime.ts apps/backend/src/runtime/startApi.ts apps/backend/src/worker/boss-adapter.ts apps/backend/src/tests/reminders/runtime.test.ts apps/backend/src/tests/worker-bootstrap.test.ts
git commit -m "feat: wire qstash reminder scheduler runtime"
```

## Task 4: QStash Raw-Body Signature Verification

**Files:**
- Modify: `apps/backend/src/reminders/internal-routes.ts`
- Modify: `apps/backend/src/runtime/createApiServer.ts`
- Modify: `apps/backend/src/tests/reminders/internal-routes.test.ts`

- [ ] **Step 1: Replace internal route tests with QStash verification cases**

Replace `apps/backend/src/tests/reminders/internal-routes.test.ts` with:

```ts
import assert from 'node:assert/strict';
import type { Server } from 'node:net';
import test from 'node:test';

import express from 'express';

import { errorMiddleware, notFoundMiddleware } from '../../middleware/error-middleware.js';
import { createReminderInternalRoutes } from '../../reminders/internal-routes.js';
import type { QstashVerifierConfig } from '../../reminders/runtime.js';
import type { ScheduledTaskExecutor } from '../../reminders/scheduled-task-executor.js';

const verifierConfig: QstashVerifierConfig = {
  currentSigningKey: 'current-signing-key',
  nextSigningKey: 'next-signing-key',
  callbackUrl: 'https://api.example.test/internal/reminders/scheduled-task',
};

const startServer = async (
  executor: ScheduledTaskExecutor,
  verify: (input: Readonly<{ signature: string; body: string; url: string }>) => Promise<boolean>,
): Promise<Readonly<{ url: string; close: () => Promise<void> }>> => {
  const app = express();
  app.use(
    express.json({
      verify: (request, _response, buffer) => {
        (request as typeof request & { rawBody?: string }).rawBody = buffer.toString('utf8');
      },
    }),
  );
  app.use(
    '/internal/reminders',
    createReminderInternalRoutes({
      executor,
      verifierConfig,
      verify,
    }),
  );
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
    close: async () =>
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
};

test('internal scheduled task route requires Upstash signature', async () => {
  const executor: ScheduledTaskExecutor = {
    execute: async () => ({ status: 'sent' }),
  };
  const server = await startServer(executor, async () => true);

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

test('internal scheduled task route verifies exact raw body and callback url before executing', async () => {
  const executed: string[] = [];
  const verified: Array<Readonly<{ signature: string; body: string; url: string }>> = [];
  const executor: ScheduledTaskExecutor = {
    execute: async (payload) => {
      executed.push(payload.reminderId);
      return { status: 'sent' };
    },
  };
  const server = await startServer(executor, async (input) => {
    verified.push(input);
    return true;
  });
  const body = JSON.stringify({
    reminderId: 'reminder-1',
    occurrenceAt: '2026-06-13T10:05:00.000Z',
    version: 1,
    deliveryKey: 'key',
  });

  try {
    const response = await fetch(`${server.url}/internal/reminders/scheduled-task`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Upstash-Signature': 'signed-jwt',
      },
      body,
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'sent' });
    assert.deepEqual(executed, ['reminder-1']);
    assert.deepEqual(verified, [
      {
        signature: 'signed-jwt',
        body,
        url: 'https://api.example.test/internal/reminders/scheduled-task',
      },
    ]);
  } finally {
    await server.close();
  }
});

test('internal scheduled task route rejects failed QStash verification', async () => {
  const executed: string[] = [];
  const executor: ScheduledTaskExecutor = {
    execute: async (payload) => {
      executed.push(payload.reminderId);
      return { status: 'sent' };
    },
  };
  const server = await startServer(executor, async () => false);

  try {
    const response = await fetch(`${server.url}/internal/reminders/scheduled-task`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Upstash-Signature': 'bad-signature',
      },
      body: JSON.stringify({
        reminderId: 'reminder-1',
        occurrenceAt: '2026-06-13T10:05:00.000Z',
        version: 1,
        deliveryKey: 'key',
      }),
    });

    assert.equal(response.status, 401);
    assert.deepEqual(executed, []);
  } finally {
    await server.close();
  }
});
```

- [ ] **Step 2: Run route tests and verify they fail**

Run:

```bash
npm --workspace apps/backend run build
node --test dist/tests/reminders/internal-routes.test.js
```

Expected: FAIL because `createReminderInternalRoutes` still expects a shared secret.

- [ ] **Step 3: Implement raw-body capture in API server**

In `apps/backend/src/runtime/createApiServer.ts`, import `type QstashVerifierConfig`:

```ts
import type { QstashVerifierConfig } from '../reminders/runtime.js';
```

Replace `reminderSchedulerSecret?: string;` with:

```ts
  reminderQstashVerifierConfig?: QstashVerifierConfig;
```

Replace `app.use(express.json());` with:

```ts
  app.use(
    express.json({
      verify: (request, _response, buffer) => {
        (request as typeof request & { rawBody?: string }).rawBody = buffer.toString('utf8');
      },
    }),
  );
```

Replace the internal route mount condition with:

```ts
  if (options.reminderScheduledTaskExecutor && options.reminderQstashVerifierConfig) {
    app.use(
      '/internal/reminders',
      createReminderInternalRoutes({
        executor: options.reminderScheduledTaskExecutor,
        verifierConfig: options.reminderQstashVerifierConfig,
      }),
    );
  }
```

- [ ] **Step 4: Implement QStash verification in internal routes**

Replace `apps/backend/src/reminders/internal-routes.ts` with:

```ts
import type { Request } from 'express';
import { Router } from 'express';
import { Receiver } from '@upstash/qstash';
import { z } from 'zod';

import { AppError } from '../middleware/error-middleware.js';
import { validateRequest, withErrorBoundary } from '../middleware/validate.js';
import type { ReminderSchedulerPayload } from './contracts.js';
import type { QstashVerifierConfig } from './runtime.js';
import type { ScheduledTaskExecutor } from './scheduled-task-executor.js';

type RawBodyRequest = Request & Readonly<{ rawBody?: string }>;

type QstashVerifyInput = Readonly<{
  signature: string;
  body: string;
  url: string;
}>;

type QstashVerify = (input: QstashVerifyInput) => Promise<boolean>;

const scheduledTaskBodySchema = z.object({
  reminderId: z.string().min(1),
  occurrenceAt: z.string().datetime(),
  version: z.number().int().positive(),
  deliveryKey: z.string().min(1),
});

const createVerifier = (config: QstashVerifierConfig): QstashVerify => {
  const receiver = new Receiver({
    currentSigningKey: config.currentSigningKey,
    nextSigningKey: config.nextSigningKey,
  });

  return (input) => receiver.verify(input);
};

export const createReminderInternalRoutes = (
  input: Readonly<{
    executor: ScheduledTaskExecutor;
    verifierConfig: QstashVerifierConfig;
    verify?: QstashVerify;
  }>,
): Router => {
  const router = Router();
  const verify = input.verify ?? createVerifier(input.verifierConfig);

  router.post(
    '/scheduled-task',
    validateRequest({ body: scheduledTaskBodySchema }),
    withErrorBoundary(async (request, response) => {
      const signature = request.header('Upstash-Signature');
      const rawBody = (request as RawBodyRequest).rawBody;

      if (!signature || rawBody === undefined) {
        throw new AppError({
          code: 'auth',
          message: 'Invalid QStash signature',
        });
      }

      const verified = await verify({
        signature,
        body: rawBody,
        url: input.verifierConfig.callbackUrl,
      });

      if (!verified) {
        throw new AppError({
          code: 'auth',
          message: 'Invalid QStash signature',
        });
      }

      const result = await input.executor.execute(request.body as ReminderSchedulerPayload);
      response.status(200).json(result);
    }),
  );

  return router;
};
```

- [ ] **Step 5: Run route tests**

Run:

```bash
npm --workspace apps/backend run build
node --test dist/tests/reminders/internal-routes.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/reminders/internal-routes.ts apps/backend/src/runtime/createApiServer.ts apps/backend/src/tests/reminders/internal-routes.test.ts
git commit -m "feat: verify qstash reminder callbacks"
```

## Task 5: Remove Generic HTTP References and Verify Contracts

**Files:**
- Modify: `docs/superpowers/plans/2026-06-13-reminder-scheduler-redesign.md`
- Modify: `docs/superpowers/specs/2026-06-13-reminder-scheduler-redesign-design.md`
- Search/modify any remaining files reported by the scans below.

- [ ] **Step 1: Scan for old scheduler transport references**

Run:

```bash
rg -n "generic-http|REMINDER_SCHEDULER_SCHEDULE_URL|REMINDER_SCHEDULER_CANCEL_URL|REMINDER_SCHEDULER_SECRET|x-reminder-scheduler-secret|createHttpSchedulerProvider|reminderSchedulerSecret" apps tests docs
```

Expected before cleanup: matches remain only in old plan history, migrated test names, and source paths not yet edited.

- [ ] **Step 2: Update old plan header to point to this cutover**

At the top of `docs/superpowers/plans/2026-06-13-reminder-scheduler-redesign.md`, directly after the required agentic-worker quote, add:

```markdown
> **Revision note:** The original plan used `generic-http` and shared-secret callbacks. The approved 2026-06-19 spec revision replaces that transport with Upstash QStash. Use `docs/superpowers/plans/2026-06-19-reminder-scheduler-qstash-cutover.md` for the QStash cutover.
```

- [ ] **Step 3: Confirm the design doc keeps QStash as the concrete provider**

In `docs/superpowers/specs/2026-06-13-reminder-scheduler-redesign-design.md`, confirm these lines exist under the provider section:

```markdown
- `REMINDER_SCHEDULER_PROVIDER=qstash`
- `REMINDER_SCHEDULER_CALLBACK_BASE_URL`
- `QSTASH_TOKEN`
- `QSTASH_CURRENT_SIGNING_KEY`
- `QSTASH_NEXT_SIGNING_KEY`
- `QSTASH_URL` optional when the default QStash endpoint is acceptable
```

If the file already contains those exact configuration names, do not edit it.

- [ ] **Step 4: Run targeted verification**

Run:

```bash
npm --workspace apps/backend run build
node --test dist/tests/auth/tokens.test.js dist/tests/reminders/scheduler-provider.test.js dist/tests/reminders/internal-routes.test.js dist/tests/reminders/runtime.test.js dist/tests/worker-bootstrap.test.js
```

Expected: PASS.

- [ ] **Step 5: Run old-reference scan again**

Run:

```bash
rg -n "generic-http|REMINDER_SCHEDULER_SCHEDULE_URL|REMINDER_SCHEDULER_CANCEL_URL|REMINDER_SCHEDULER_SECRET|x-reminder-scheduler-secret|createHttpSchedulerProvider|reminderSchedulerSecret" apps tests
```

Expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-06-13-reminder-scheduler-redesign.md docs/superpowers/specs/2026-06-13-reminder-scheduler-redesign-design.md apps/backend/src apps/backend/package.json package-lock.json
git commit -m "chore: remove generic reminder scheduler references"
```

## Task 6: Final Verification

**Files:**
- No new files.
- Verify all files changed in Tasks 1-5.

- [ ] **Step 1: Run lint**

Run:

```bash
npm run lint
```

Expected: exits 0.

- [ ] **Step 2: Run backend tests**

Run:

```bash
$env:DATABASE_URL='postgres://localhost:5432/ai-note-keeper-test'; npm --workspace apps/backend run test
```

Expected: exits 0.

- [ ] **Step 3: Run full test suite**

Run:

```bash
$env:DATABASE_URL='postgres://localhost:5432/ai-note-keeper-test'; npm test
```

Expected: exits 0.

- [ ] **Step 4: Confirm Android build was not run**

Run:

```bash
git diff --name-only
```

Expected: changed files are backend source/tests, package manifests, and docs only. Do not run Android builds for this plan.

- [ ] **Step 5: Commit**

```bash
git status --short
git add apps/backend package-lock.json docs/superpowers/plans/2026-06-13-reminder-scheduler-redesign.md docs/superpowers/plans/2026-06-19-reminder-scheduler-qstash-cutover.md
git commit -m "test: verify qstash reminder scheduler cutover"
```

## Self-Review

Spec coverage:

- Upstash QStash concrete provider: covered by Tasks 1-3 with `REMINDER_SCHEDULER_PROVIDER=qstash`, `QSTASH_TOKEN`, optional `QSTASH_URL`, `Client.publishJSON`, and `client.messages.cancel`.
- Callback URL derived from `REMINDER_SCHEDULER_CALLBACK_BASE_URL`: covered by `createReminderSchedulerCallbackUrl` in Task 3 and route verification in Task 4.
- Native QStash signature verification: covered by Task 4 using `Receiver.verify`, `Upstash-Signature`, exact raw request body, and exact callback URL.
- Shared-secret callback removal: covered by Tasks 4-5 removing `x-reminder-scheduler-secret`, `REMINDER_SCHEDULER_SECRET`, and `reminderSchedulerSecret`.
- Stable route path `/internal/reminders/scheduled-task`: preserved in runtime URL construction and route mount.
- Disabled provider rollback: preserved in Tasks 1-3 and tested by the disabled provider test.
- Existing reminder correctness model: unchanged by this plan; scheduler service, delivery ledger, scheduled-task executor, and repair job remain the source of reminder behavior.

Placeholder scan:

- The plan uses concrete file paths, commands, expected results, code snippets, and defined function names.

Type consistency:

- Runtime exposes `qstashVerifierConfig`, API server accepts `reminderQstashVerifierConfig`, and routes accept `verifierConfig`.
- Provider names use `qstash` in config, persisted scheduler metadata, tests, and worker dispatch-mode checks.
- The scheduled payload remains `reminderId`, `occurrenceAt`, `version`, and `deliveryKey`.

Plan complete and saved to `docs/superpowers/plans/2026-06-19-reminder-scheduler-qstash-cutover.md`. Two execution options:

**1. Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
