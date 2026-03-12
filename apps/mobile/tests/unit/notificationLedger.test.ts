import {
  isUniqueConstraintError,
  tryRecordNotificationSent,
  type DbLike,
} from '../../src/reminders/notificationLedger';

describe('notificationLedger dedup', () => {
  const makeDb = (runAsync: jest.Mock): DbLike =>
    ({
      runAsync,
    }) as unknown as DbLike;

  it('returns true when insert succeeds', async () => {
    const db = makeDb(jest.fn().mockResolvedValue(undefined));

    const claimed = await tryRecordNotificationSent(db, 'note-1', 'note-1-123', 'fcm');

    expect(claimed).toBe(true);
  });

  it('returns false on unique-constraint collision', async () => {
    const db = makeDb(
      jest
        .fn()
        .mockRejectedValue(
          new Error(
            'UNIQUE constraint failed: notification_ledger.reminderId, notification_ledger.eventId',
          ),
        ),
    );

    const claimed = await tryRecordNotificationSent(db, 'note-1', 'note-1-123', 'local');

    expect(claimed).toBe(false);
  });

  it('rethrows unexpected database errors', async () => {
    const db = makeDb(jest.fn().mockRejectedValue(new Error('disk I/O error')));

    await expect(tryRecordNotificationSent(db, 'note-1', 'note-1-123', 'fcm')).rejects.toThrow(
      'disk I/O error',
    );
  });

  it('detects common sqlite unique error variants', () => {
    expect(isUniqueConstraintError(new Error('SQLITE_CONSTRAINT_UNIQUE'))).toBe(true);
    expect(isUniqueConstraintError(new Error('SQLITE_CONSTRAINT_PRIMARYKEY'))).toBe(true);
    expect(isUniqueConstraintError(new Error('constraint failed'))).toBe(true);
    expect(isUniqueConstraintError(new Error('something else'))).toBe(false);
  });
});
