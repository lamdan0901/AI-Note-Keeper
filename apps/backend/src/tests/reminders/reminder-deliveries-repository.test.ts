import assert from 'node:assert/strict';
import test from 'node:test';

import type { DbQueryClient } from '../../auth/contracts.js';
import { createReminderDeliveriesRepository } from '../../reminders/repositories/reminder-deliveries-repository.js';

type QueryCall = Readonly<{ text: string; values: ReadonlyArray<unknown> | undefined }>;

const createDb = (
  calls: QueryCall[],
  rows: ReadonlyArray<Record<string, unknown>> = [],
): DbQueryClient => ({
  query: async <T extends Record<string, unknown>>(
    text: string,
    values?: ReadonlyArray<unknown>,
  ) => {
    calls.push({ text, values });
    return { rows: rows as ReadonlyArray<T> };
  },
});

test('delivery repository inserts pending row with occurrence and delivery uniqueness', async () => {
  const calls: QueryCall[] = [];
  const createdAt = new Date('2026-06-13T10:00:00.000Z');
  const occurrenceAt = new Date('2026-06-13T10:05:00.000Z');
  const repository = createReminderDeliveriesRepository({
    db: createDb(calls, [
      {
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
      },
    ]),
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
