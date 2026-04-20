import type { ExportDataset, ExportSourceAdapter } from '../contracts.js';

const defaultFixtureDataset = (): ExportDataset => {
  return {
    generatedAt: '1970-01-01T00:00:00.000Z',
    resumeToken: null,
    entities: {
      users: [
        { id: 'user-b', username: 'bob' },
        { id: 'user-a', username: 'alice' },
      ],
      notes: [
        { id: 'note-2', userId: 'user-a', updatedAt: 20, createdAt: 5 },
        { id: 'note-1', userId: 'user-a', updatedAt: 10, createdAt: 4 },
      ],
      noteChangeEvents: [
        {
          id: 'event-2',
          noteId: 'note-2',
          userId: 'user-a',
          operation: 'updated',
          payloadHash: 'hash-2',
        },
        {
          id: 'event-1',
          noteId: 'note-1',
          userId: 'user-a',
          operation: 'created',
          payloadHash: 'hash-1',
        },
      ],
      subscriptions: [{ id: 'sub-1', userId: 'user-a', serviceName: 'music-box' }],
      devicePushTokens: [
        { id: 'token-2', userId: 'user-a', deviceId: 'device-2', tokenHash: 'th-2' },
        { id: 'token-1', userId: 'user-a', deviceId: 'device-1', tokenHash: 'th-1' },
      ],
      cronState: [{ key: 'check-reminders', lastCheckedAt: 1700000000000 }],
      migrationAttempts: [
        { id: 'attempt-2', key: 'merge-user-a' },
        { id: 'attempt-1', key: 'merge-user-0' },
      ],
      refreshTokens: [
        { id: 'refresh-2', userId: 'user-a', tokenHash: 'rh-2' },
        { id: 'refresh-1', userId: 'user-a', tokenHash: 'rh-1' },
      ],
    },
  };
};

export const createFixtureConvexExportSource = (
  fixtureFactory: () => ExportDataset = defaultFixtureDataset,
): ExportSourceAdapter => {
  return {
    loadDataset: async () => fixtureFactory(),
  };
};
