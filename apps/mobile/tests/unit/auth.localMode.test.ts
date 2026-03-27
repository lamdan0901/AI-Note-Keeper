import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const getDbMock: jest.Mock = jest.fn();
const saveNoteOfflineMock: jest.Mock = jest.fn(async () => undefined);

jest.mock('../../src/db/bootstrap', () => ({
  getDb: getDbMock,
}));

jest.mock('../../src/notes/editor', () => ({
  saveNoteOffline: saveNoteOfflineMock,
}));

import { seedWelcomeSampleNoteIfNeeded } from '../../src/auth/localMode';
import {
  WELCOME_NOTE_CONTENT,
  WELCOME_NOTE_TITLE,
} from '../../../../packages/shared/constants/welcomeNote';

describe('local mode welcome sample note', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('seeds sample note for empty user notes', async () => {
    const db = {
      getAllAsync: jest.fn(async () => [{ count: 0 }]),
    };
    (getDbMock as any).mockResolvedValue(db);

    const seeded = await seedWelcomeSampleNoteIfNeeded('device-1');

    expect(seeded).toBe(true);
    expect(db.getAllAsync as any).toHaveBeenCalledWith(
      'SELECT COUNT(*) as count FROM notes WHERE userId = ? AND active = 1',
      ['device-1'],
    );
    expect(saveNoteOfflineMock).toHaveBeenCalledTimes(1);
    expect(saveNoteOfflineMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        id: 'welcome-device-1',
        userId: 'device-1',
        title: WELCOME_NOTE_TITLE,
        content: WELCOME_NOTE_CONTENT,
        active: true,
        done: false,
        isPinned: false,
      }),
      'create',
      'device-1',
    );
  });

  it('does not seed sample note when user already has active notes', async () => {
    const db = {
      getAllAsync: jest.fn(async () => [{ count: 1 }]),
    };
    (getDbMock as any).mockResolvedValue(db);

    const seeded = await seedWelcomeSampleNoteIfNeeded('device-1');

    expect(seeded).toBe(false);
    expect(saveNoteOfflineMock).not.toHaveBeenCalled();
  });
});
