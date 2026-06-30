import assert from 'node:assert/strict';
import test from 'node:test';

import { createQStashSchedulerProvider } from '../../reminders/qstash-scheduler-provider.js';

type RecordedCall = Readonly<{ url: string; method: string; body: unknown; headers: unknown }>;

const recordCall = (
  calls: RecordedCall[],
  url: string | URL | Request,
  init: RequestInit | undefined,
  method: string,
): void => {
  calls.push({
    url: String(url),
    method,
    body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    headers: init?.headers,
  });
};

const callbackUrl = 'https://backend.example.test/internal/reminders/scheduled-task';

test('qstash scheduler provider publishes to /v2/publish with not-before and forwarded secret headers', async () => {
  const calls: RecordedCall[] = [];
  const provider = createQStashSchedulerProvider({
    token: 'qstash-token',
    callbackUrl,
    secret: 'scheduler-secret',
    fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
      recordCall(calls, url, init, 'POST');
      return new Response(JSON.stringify({ messageId: 'msg-1' }), { status: 200 });
    },
  });

  const result = await provider.scheduleOnce({
    reminderId: 'reminder-1',
    occurrenceAt: new Date('2026-06-13T10:05:00.000Z'),
    version: 3,
    deliveryKey: 'reminder-1:1781345100000:v3',
  });

  assert.equal(result.provider, 'qstash');
  assert.equal(result.scheduleId, 'msg-1');
  assert.equal(result.fireAt.toISOString(), '2026-06-13T10:05:00.000Z');
  assert.equal(
    calls[0].url,
    `https://qstash.upstash.io/v2/publish/${encodeURIComponent(callbackUrl)}`,
  );
  assert.deepEqual(calls[0].body, {
    reminderId: 'reminder-1',
    occurrenceAt: '2026-06-13T10:05:00.000Z',
    version: 3,
    deliveryKey: 'reminder-1:1781345100000:v3',
  });

  const headers = calls[0].headers as Record<string, string>;
  assert.equal(headers['authorization'], 'Bearer qstash-token');
  // occurrenceAt 2026-06-13T10:05:00.000Z = 1781345100 seconds
  assert.equal(headers['upstash-not-before'], '1781345100');
  // Custom headers are forwarded to the destination with the Upstash-Forward- prefix.
  assert.equal(headers['upstash-forward-x-reminder-scheduler-secret'], 'scheduler-secret');
});

test('qstash scheduler provider cancel deletes the message best-effort and does not throw on non-2xx', async () => {
  const calls: RecordedCall[] = [];
  const provider = createQStashSchedulerProvider({
    token: 'qstash-token',
    callbackUrl,
    secret: 'scheduler-secret',
    fetchImpl: async (url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url: String(url), method, body: undefined, headers: init?.headers });
      // QStash returns 404 when the message has already fired.
      return new Response('not found', { status: 404 });
    },
  });

  await provider.cancel({ scheduleId: 'msg-1' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'DELETE');
  assert.equal(calls[0].url, 'https://qstash.upstash.io/v2/messages/msg-1');
  assert.equal((calls[0].headers as Record<string, string>)['authorization'], 'Bearer qstash-token');
});

test('qstash scheduler provider scheduleOnce throws when QStash returns an error status', async () => {
  const provider = createQStashSchedulerProvider({
    token: 'qstash-token',
    callbackUrl,
    secret: 'scheduler-secret',
    fetchImpl: async () => new Response('rate limited', { status: 429 }),
  });

  await assert.rejects(
    () =>
      provider.scheduleOnce({
        reminderId: 'reminder-1',
        occurrenceAt: new Date('2026-06-13T10:05:00.000Z'),
        version: 3,
        deliveryKey: 'reminder-1:1781345100000:v3',
      }),
    /publish failed with 429/i,
  );
});
