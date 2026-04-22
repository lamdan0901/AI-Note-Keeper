import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  clearLocalUserData,
  clearLocalUserDataForLogout,
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
};

const createDb = (): MockDb => ({
  runAsync: jest.fn(async () => undefined),
});

describe('local user data cleanup', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('skips native notification cleanup for notes without schedule metadata', async () => {
    const db = createDb();
    (listNoteIdsWithScheduleStateForUserMock as any).mockResolvedValueOnce([]);

    const result = await clearLocalUserDataForLogout(db as never, 'account-user-1');

    expect(result).toEqual(
      expect.objectContaining({
        notificationCleanupCount: 0,
      }),
    );
    expect(clearNoteNotificationStateMock).not.toHaveBeenCalled();
    expect(db.runAsync).toHaveBeenNthCalledWith(1, 'DELETE FROM note_outbox WHERE userId = ?', [
      'account-user-1',
    ]);
    expect(db.runAsync).toHaveBeenNthCalledWith(2, 'DELETE FROM notes WHERE userId = ?', [
      'account-user-1',
    ]);
  });

  it('cleans native notification state only for notes with schedule metadata', async () => {
    const db = createDb();
    (listNoteIdsWithScheduleStateForUserMock as any).mockResolvedValueOnce(['note-2', 'note-9']);

    const result = await clearLocalUserDataForLogout(db as never, 'account-user-1');

    expect(result).toEqual(
      expect.objectContaining({
        notificationCleanupCount: 2,
      }),
    );
    expect(clearNoteNotificationStateMock).toHaveBeenNthCalledWith(1, db, 'note-2');
    expect(clearNoteNotificationStateMock).toHaveBeenNthCalledWith(2, db, 'note-9');
  });

  it('still deletes all user-scoped rows regardless of notification metadata', async () => {
    const db = createDb();
    (listNoteIdsWithScheduleStateForUserMock as any).mockResolvedValueOnce(['note-2']);

    const ok = await clearLocalUserData(db as never, 'account-user-1');

    expect(ok).toBe(true);
    expect(db.runAsync).toHaveBeenNthCalledWith(1, 'DELETE FROM note_outbox WHERE userId = ?', [
      'account-user-1',
    ]);
    expect(db.runAsync).toHaveBeenNthCalledWith(2, 'DELETE FROM notes WHERE userId = ?', [
      'account-user-1',
    ]);
  });

  it('treats anonymous logout as no-op for data deletion', async () => {
    const db = createDb();

    const result = await clearLocalUserDataForLogout(db as never, '');

    expect(result).toEqual({
      notificationCleanupCount: 0,
      notificationCleanupDurationMs: 0,
      deleteDurationMs: 0,
    });
    expect(listNoteIdsWithScheduleStateForUserMock).not.toHaveBeenCalled();
    expect(clearNoteNotificationStateMock).not.toHaveBeenCalled();
    expect(db.runAsync).not.toHaveBeenCalled();
  });
});
