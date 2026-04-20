import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWebApiClient } from '../src/api/httpClient';

describe('subscriptions express api transport', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('targets subscriptions REST endpoints after cutover', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ subscriptions: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ subscription: { id: 'sub-1' } }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ restored: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const client = createWebApiClient({
      getAccessToken: () => 'token',
      refreshAccessToken: async () => 'token',
    });

    await client.requestJson('/api/subscriptions');
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
    await client.requestJson('/api/subscriptions/sub-1/restore', {
      method: 'POST',
    });

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('http://localhost:3000/api/subscriptions');
    expect(fetchSpy.mock.calls[1]?.[0]).toBe('http://localhost:3000/api/subscriptions');
    expect(fetchSpy.mock.calls[2]?.[0]).toBe(
      'http://localhost:3000/api/subscriptions/sub-1/restore',
    );
  });
});
