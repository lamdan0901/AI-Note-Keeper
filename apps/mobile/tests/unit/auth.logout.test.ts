import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const getDbMock = jest.fn();
const clearLocalUserDataMock = jest.fn(async () => true);
const backfillMissingLocalUserIdMock = jest.fn(async () => undefined);

jest.mock('../../src/db/bootstrap', () => ({
  getDb: getDbMock,
}));

jest.mock('../../src/auth/localUserData', () => ({
  clearLocalUserData: clearLocalUserDataMock,
  backfillMissingLocalUserId: backfillMissingLocalUserIdMock,
  clearAllLocalData: jest.fn(async () => true),
  inspectLocalDataFootprint: jest.fn(async () => ({
    hasAnyData: false,
    hasLegacyOnlyData: false,
    hasNonLegacyData: false,
  })),
  migrateLocalUserData: jest.fn(async () => true),
}));

import { clearAuthenticatedMobileUserData } from '../../src/auth/logoutCleanup';

describe('mobile logout cleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clears authenticated user data and preserves device-scoped data on logout', async () => {
    const db = { id: 'db' };
    (getDbMock as any).mockResolvedValue(db);

    await clearAuthenticatedMobileUserData('account-user-1', 'device-user-1');

    expect(getDbMock).toHaveBeenCalledTimes(1);
    expect(clearLocalUserDataMock as any).toHaveBeenCalledWith(db, 'account-user-1');
    expect(backfillMissingLocalUserIdMock as any).toHaveBeenCalledWith(
      db,
      'device-user-1',
    );
  });

  it('does not clear anonymous device data when logging out from the device user', async () => {
    const db = { id: 'db' };
    (getDbMock as any).mockResolvedValue(db);

    await clearAuthenticatedMobileUserData('device-user-1', 'device-user-1');

    expect(clearLocalUserDataMock).not.toHaveBeenCalled();
    expect(getDbMock).toHaveBeenCalledTimes(1);
    expect(backfillMissingLocalUserIdMock as any).toHaveBeenCalledWith(
      db,
      'device-user-1',
    );
  });
});
