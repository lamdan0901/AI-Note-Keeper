import { describe, expect, it, vi } from 'vitest';

import { createRefreshSingleFlight } from '../src/auth/refreshSingleFlight';

describe('refresh single-flight', () => {
  it('shares one in-flight refresh across concurrent callers', async () => {
    let resolveRefresh: (value: string) => void = () => {};
    const refresh = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const refreshAccessToken = createRefreshSingleFlight(refresh);

    const first = refreshAccessToken();
    const second = refreshAccessToken();

    expect(refresh).toHaveBeenCalledTimes(1);

    resolveRefresh('fresh-token');

    await expect(first).resolves.toBe('fresh-token');
    await expect(second).resolves.toBe('fresh-token');
  });

  it('allows a new refresh after the previous in-flight refresh settles', async () => {
    const refresh = vi.fn().mockResolvedValueOnce('fresh-1').mockResolvedValueOnce('fresh-2');
    const refreshAccessToken = createRefreshSingleFlight(refresh);

    await expect(refreshAccessToken()).resolves.toBe('fresh-1');
    await expect(refreshAccessToken()).resolves.toBe('fresh-2');

    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
