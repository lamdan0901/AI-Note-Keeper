import { getDb } from '../db/bootstrap';
import {
  backfillMissingLocalUserId as backfillUserIdInDb,
  clearLocalUserDataForLogout as clearLocalUserDataForLogoutInDb,
} from './localUserData';

export const clearAuthenticatedMobileUserData = async (
  previousUserId: string,
  deviceId: string,
): Promise<void> => {
  const startedAt = Date.now();
  const db = await getDb();

  if (previousUserId && previousUserId !== deviceId) {
    const cleanupResult = await clearLocalUserDataForLogoutInDb(db, previousUserId);
    if (!cleanupResult) {
      throw new Error('Clearing authenticated mobile user data failed');
    }

    console.log('[Auth] Logout notification cleanup finished', {
      previousUserId,
      notificationCleanupCount: cleanupResult.notificationCleanupCount,
      durationMs: cleanupResult.notificationCleanupDurationMs,
    });
    console.log('[Auth] Logout DB delete finished', {
      previousUserId,
      durationMs: cleanupResult.deleteDurationMs,
    });
  }

  await backfillUserIdInDb(db, deviceId);

  console.log('[Auth] Logout local cleanup finished', {
    previousUserId,
    deviceId,
    durationMs: Date.now() - startedAt,
  });
};
