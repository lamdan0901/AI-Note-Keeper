import { describe, expect, it, jest } from '@jest/globals';
import { backfillMissingLocalUserId, migrateLocalUserData } from '../../src/auth/localUserData';

type MockDb = {
  runAsync: jest.Mock;
};

const createDb = (): MockDb => ({
  runAsync: jest.fn(async () => undefined),
});

describe('anonymous to authenticated local merge', () => {
  it('is a no-op when from and to are the same user', async () => {
    const db = createDb();

    const ok = await migrateLocalUserData(db as any, 'same-id', 'same-id');

    expect(ok).toBe(true);
    expect(db.runAsync).not.toHaveBeenCalled();
  });

  it('updates notes and outbox ownership for migration', async () => {
    const db = createDb();

    const ok = await migrateLocalUserData(db as any, 'device-123', 'account-999');

    expect(ok).toBe(true);
    expect(db.runAsync).toHaveBeenNthCalledWith(
      1,
      'UPDATE notes SET userId = ? WHERE userId = ? OR userId IS NULL',
      ['account-999', 'device-123'],
    );
    expect(db.runAsync).toHaveBeenNthCalledWith(
      2,
      'UPDATE note_outbox SET userId = ? WHERE userId = ?',
      ['account-999', 'device-123'],
    );
  });

  it('returns false if migration SQL fails', async () => {
    const db = createDb();
    (db.runAsync as any).mockRejectedValueOnce(new Error('db failure'));

    const ok = await migrateLocalUserData(db as any, 'device-123', 'account-999');

    expect(ok).toBe(false);
  });

  it('backfills missing note userId values', async () => {
    const db = createDb();

    await backfillMissingLocalUserId(db as any, 'active-user-id');

    expect(db.runAsync).toHaveBeenCalledWith('UPDATE notes SET userId = ? WHERE userId IS NULL', [
      'active-user-id',
    ]);
  });
});
