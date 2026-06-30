import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWebApiClient } from '../src/api/httpClient';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('subscriptions express api transport', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('targets all subscriptions REST endpoints used by the web client', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ subscriptions: [] }))
      .mockResolvedValueOnce(jsonResponse({ subscriptions: [] }))
      .mockResolvedValueOnce(jsonResponse({ subscription: { id: 'sub-1' } }, 201))
      .mockResolvedValueOnce(jsonResponse({ subscription: { id: 'sub-1' } }))
      .mockResolvedValueOnce(jsonResponse({ deleted: true }))
      .mockResolvedValueOnce(jsonResponse({ restored: true }))
      .mockResolvedValueOnce(jsonResponse({ deleted: true }))
      .mockResolvedValueOnce(jsonResponse({ deleted: 1 }));

    const client = createWebApiClient({
      getAccessToken: () => 'token',
      refreshAccessToken: async () => 'token',
    });

    await client.requestJson('/api/subscriptions');
    await client.requestJson('/api/subscriptions/trash');
    await client.requestJson('/api/subscriptions', {
      method: 'POST',
      body: {
        serviceName: 'Music',
        category: 'Entertainment',
        price: 10,
        currency: 'USD',
        billingCycle: 'monthly',
        billingCycleCustomDays: null,
        nextBillingDate: Date.now(),
        notes: null,
        trialEndDate: null,
        status: 'active',
        reminderDaysBefore: [1],
      },
    });
    await client.requestJson('/api/subscriptions/sub-1', {
      method: 'PATCH',
      body: { price: 12 },
    });
    await client.requestJson('/api/subscriptions/sub-1', {
      method: 'DELETE',
    });
    await client.requestJson('/api/subscriptions/sub-1/restore', {
      method: 'POST',
    });
    await client.requestJson('/api/subscriptions/sub-1/permanent', {
      method: 'DELETE',
    });
    await client.requestJson('/api/subscriptions/trash/empty', {
      method: 'DELETE',
    });

    const base = 'http://localhost:3000';
    expect(fetchSpy.mock.calls.map((call) => call[0])).toEqual([
      `${base}/api/subscriptions`,
      `${base}/api/subscriptions/trash`,
      `${base}/api/subscriptions`,
      `${base}/api/subscriptions/sub-1`,
      `${base}/api/subscriptions/sub-1`,
      `${base}/api/subscriptions/sub-1/restore`,
      `${base}/api/subscriptions/sub-1/permanent`,
      `${base}/api/subscriptions/trash/empty`,
    ]);
  });

  it('only changes host via VITE_API_BASE_URL at api-next cutover', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3001');

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ subscriptions: [] }));

    const client = createWebApiClient({
      getAccessToken: () => 'token',
      refreshAccessToken: async () => 'token',
    });

    await client.requestJson('/api/subscriptions');

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('http://localhost:3001/api/subscriptions');
  });
});
