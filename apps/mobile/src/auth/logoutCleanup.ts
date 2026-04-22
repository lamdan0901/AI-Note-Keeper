import { getDb } from '../db/bootstrap';
import {
  backfillMissingLocalUserId as backfillUserIdInDb,
  clearLocalUserData as clearLocalUserDataInDb,
} from './localUserData';

export const clearAuthenticatedMobileUserData = async (
  previousUserId: string,
  deviceId: string,
): Promise<void> => {
  const db = await getDb();

  if (previousUserId && previousUserId !== deviceId) {
    const cleared = await clearLocalUserDataInDb(db, previousUserId);
    if (!cleared) {
      throw new Error('Clearing authenticated mobile user data failed');
    }
  }
  await backfillUserIdInDb(db, deviceId);
};
