import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  backfillMissingLocalUserId,
  clearLocalUserData,
  inspectLocalDataFootprint,
  migrateLocalUserData,
} from '../../src/auth/localUserData';

const clearNoteNotificationStateMock: jest.Mock = jest.fn(async () => undefined);
const listNoteIdsWithScheduleStateForUserMock: jest.Mock = jest.fn(async () => []);

jest.mock('../../src/reminders/noteNotificationCleanup', () => ({
  clearNoteNotificationState: (...args: unknown[]) => clearNoteNotificationStateMock(...args),
}));

jest.mock('../../src/reminders/noteScheduleLedger', () => ({
  listNoteIdsWithScheduleStateForUser: (...args: unknown[]) =>
    listNoteIdsWithScheduleStateForUserMock(...args),
}));

type MockDb = {
  runAsync: jest.Mock;
  getAllAsync: jest.Mock;
};

const createDb = (): MockDb => ({
  runAsync: jest.fn(async () => undefined),
  getAllAsync: jest.fn(async () => []),
});

describe('anonymous to authenticated local merge', () => {
  afterEach(() => {
    clearNoteNotificationStateMock.mockClear();
    listNoteIdsWithScheduleStateForUserMock.mockClear();
  });

  it('clears only scoped local data and notification state', async () => {
    const db = createDb();
    (listNoteIdsWithScheduleStateForUserMock as any).mockResolvedValueOnce(['note-1', 'note-2']);

    const ok = await clearLocalUserData(db as any, 'device-123');

    expect(ok).toBe(true);
    expect(listNoteIdsWithScheduleStateForUserMock).toHaveBeenCalledWith(db, 'device-123');
    expect(clearNoteNotificationStateMock).toHaveBeenNthCalledWith(1, db, 'note-1');
    expect(clearNoteNotificationStateMock).toHaveBeenNthCalledWith(2, db, 'note-2');
    expect(db.runAsync).toHaveBeenNthCalledWith(1, 'DELETE FROM note_outbox WHERE userId = ?', [
      'device-123',
    ]);
    expect(db.runAsync).toHaveBeenNthCalledWith(2, 'DELETE FROM notes WHERE userId = ?', [
      'device-123',
    ]);
  });

  it('returns false if clear local data fails', async () => {
    const db = createDb();
    (listNoteIdsWithScheduleStateForUserMock as any).mockResolvedValueOnce(['note-1']);
    (db.runAsync as any).mockRejectedValueOnce(new Error('db failure'));

    const ok = await clearLocalUserData(db as any, 'device-123');

    expect(ok).toBe(false);
  });

  it('reports legacy-only local data footprint', async () => {
    const db = createDb();
    (db.getAllAsync as any)
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ count: 1 }]);

    const footprint = await inspectLocalDataFootprint(db as any);

    expect(footprint).toEqual({
      hasAnyData: true,
      hasLegacyOnlyData: true,
      hasNonLegacyData: false,
    });
  });

  it('reports non-legacy local data footprint', async () => {
    const db = createDb();
    (db.getAllAsync as any)
      .mockResolvedValueOnce([{ count: 2 }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ count: 0 }]);

    const footprint = await inspectLocalDataFootprint(db as any);

    expect(footprint).toEqual({
      hasAnyData: true,
      hasLegacyOnlyData: false,
      hasNonLegacyData: true,
    });
  });

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
    expect(db.runAsync).toHaveBeenNthCalledWith(1, 'UPDATE notes SET userId = ? WHERE userId = ?', [
      'account-999',
      'device-123',
    ]);
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
