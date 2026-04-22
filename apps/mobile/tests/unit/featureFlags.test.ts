import { afterEach, describe, expect, it, jest } from '@jest/globals';

describe('feature flags', () => {
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_MOBILE_NOTES_REALTIME_V1;
    jest.resetModules();
  });

  it('defaults mobile realtime notes flag to false', async () => {
    const { isMobileNotesRealtimeV1Enabled } = await import('../../src/constants/featureFlags');

    expect(isMobileNotesRealtimeV1Enabled()).toBe(false);
  });

  it('parses truthy mobile realtime notes values from env', async () => {
    process.env.EXPO_PUBLIC_MOBILE_NOTES_REALTIME_V1 = 'YES';
    const { isMobileNotesRealtimeV1Enabled } = await import('../../src/constants/featureFlags');

    expect(isMobileNotesRealtimeV1Enabled()).toBe(true);
  });
});
