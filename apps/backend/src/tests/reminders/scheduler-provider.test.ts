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
