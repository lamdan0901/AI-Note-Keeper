import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWebApiClient } from '../src/api/httpClient';
import { NOTES_POLL_INTERVAL_MS } from '../src/services/notes';

describe('notes express api transport', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('uses /api/notes and /api/notes/sync endpoints', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ notes: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ notes: [], syncedAt: Date.now() }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const client = createWebApiClient({
      getAccessToken: () => 'token',
      refreshAccessToken: async () => 'token',
    });

    await client.requestJson('/api/notes');
    await client.requestJson('/api/notes/sync', {
      method: 'POST',
      body: {
        lastSyncAt: Date.now(),
        changes: [
          {
            id: 'note-1',
            userId: 'user-1',
            operation: 'create',
            payloadHash: 'hash',
            deviceId: 'web',
            updatedAt: Date.now(),
          },
        ],
      },
    });

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('http://localhost:3000/api/notes');
    expect(fetchSpy.mock.calls[1]?.[0]).toBe('http://localhost:3000/api/notes/sync');
  });

  it('locks polling interval at 30 seconds', () => {
    expect(NOTES_POLL_INTERVAL_MS).toBe(30_000);
  });
});
