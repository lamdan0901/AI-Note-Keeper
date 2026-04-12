import { test, expect, jest, describe, beforeEach } from '@jest/globals';
import { makeContext, withAuth } from '../helpers/makeContext';

const mockListDocuments = jest.fn() as any;
const mockCreateDocument = jest.fn() as any;
const mockUpdateDocument = jest.fn() as any;
const mockDeleteDocument = jest.fn() as any;
const mockCreateExecution = jest.fn() as any;

jest.mock('node-appwrite', () => ({
  Client: jest.fn().mockImplementation(() => ({
    setEndpoint: jest.fn().mockReturnThis(),
    setProject: jest.fn().mockReturnThis(),
    setKey: jest.fn().mockReturnThis(),
  })),
  Databases: jest.fn().mockImplementation(() => ({
    listDocuments: mockListDocuments,
    createDocument: mockCreateDocument,
    updateDocument: mockUpdateDocument,
    deleteDocument: mockDeleteDocument,
  })),
  Functions: jest.fn().mockImplementation(() => ({
    createExecution: mockCreateExecution,
  })),
  ID: { unique: () => 'gen-id' },
  Query: {
    equal: (field: string, value: string) => `${field}=${value}`,
    greaterThan: (field: string, value: number) => `${field}>${value}`,
  },
  Permission: {
    read: (role: string) => `read:${role}`,
    write: (role: string) => `write:${role}`,
  },
  Role: {
    user: (userId: string) => `user:${userId}`,
  },
}));

import main from '../../appwrite-functions/notes-sync/src/main';

const DB = 'ai-note-keeper';
const NOTES = 'notes';
const USER = 'user-abc';
const AUTH = withAuth(USER);

beforeEach(() => {
  jest.clearAllMocks();
  process.env.APPWRITE_FUNCTION_API_ENDPOINT = 'https://cloud.appwrite.io/v1';
  process.env.APPWRITE_FUNCTION_API_KEY = 'test-key';
  process.env.APPWRITE_FUNCTION_PROJECT_ID = 'test-project-id';
  mockCreateExecution.mockResolvedValue({ $id: 'exec-1' });
  mockListDocuments.mockResolvedValue({ documents: [] });
  mockCreateDocument.mockImplementation((_db: string, _col: string, id: string, data: unknown) =>
    Promise.resolve({ $id: id, ...(data as object) }),
  );
  mockUpdateDocument.mockImplementation((_db: string, _col: string, id: string, data: unknown) =>
    Promise.resolve({ $id: id, ...(data as object) }),
  );
  mockDeleteDocument.mockResolvedValue({});
});

describe('notesSyncRoundTrip integration', () => {
  test('POST sync creates note, then GET returns it', async () => {
    const noteId = 'note-round-trip-1';
    const noteData = {
      id: noteId,
      userId: USER,
      title: 'Round-trip note',
      content: 'Hello world',
      active: true,
      updatedAt: 1700000000000,
      createdAt: 1700000000000,
      operation: 'create',
    };

    // Define createdNote before POST so canonical-state mock can reference it.
    // Handler calls listDocuments twice during POST:
    //   1st call: check if note already exists (should return empty → create path)
    //   2nd call: fetch canonical state to return in response (should return the new note)
    const createdNote = { $id: noteId, ...noteData, version: 1 };
    mockListDocuments
      .mockResolvedValueOnce({ documents: [] }) // existing-check → create path
      .mockResolvedValue({ documents: [createdNote] }); // canonical state + subsequent GET

    // POST: create note via sync
    const { context: postCtx, responses: postResponses } = makeContext({
      method: 'POST',
      path: '/',
      headers: AUTH,
      body: JSON.stringify({ userId: USER, changes: [noteData], lastSyncAt: 0 }),
    });

    await main(postCtx);

    expect(postResponses[0].status).toBe(200);
    expect(mockCreateDocument).toHaveBeenCalledWith(
      DB,
      NOTES,
      noteId,
      expect.objectContaining({ title: 'Round-trip note', userId: USER }),
      expect.any(Array),
    );

    // Assert server-canonical response fields required by the migration plan
    const postData = postResponses[0].data as {
      notes: Array<{ id: string; title: string }>;
      syncedAt: number;
    };
    expect(typeof postData.syncedAt).toBe('number');
    expect(postData.notes).toHaveLength(1);
    expect(postData.notes[0].id).toBe(noteId);
    expect(postData.notes[0].title).toBe('Round-trip note');

    // GET: retrieve synced notes
    const { context: getCtx, responses: getResponses } = makeContext({
      method: 'GET',
      path: '/',
      headers: AUTH,
      query: { userId: USER },
    });

    await main(getCtx);

    expect(getResponses[0].status).toBe(200);
    const getData = getResponses[0].data as {
      notes: Array<{ id: string; title: string }>;
      syncedAt: number;
    };
    expect(typeof getData.syncedAt).toBe('number');
    expect(getData.notes.length).toBe(1);
    expect(getData.notes[0].title).toBe('Round-trip note');
  });

  test('sync multiple notes in single request', async () => {
    const notes = [
      {
        id: 'n1',
        userId: USER,
        title: 'Note 1',
        active: true,
        updatedAt: 1000,
        createdAt: 900,
        operation: 'create',
      },
      {
        id: 'n2',
        userId: USER,
        title: 'Note 2',
        active: true,
        updatedAt: 1000,
        createdAt: 900,
        operation: 'create',
      },
    ];

    const { context, responses } = makeContext({
      method: 'POST',
      path: '/',
      headers: AUTH,
      body: JSON.stringify({ userId: USER, changes: notes, lastSyncAt: 0 }),
    });

    await main(context);

    expect(responses[0].status).toBe(200);
    const noteCalls = (mockCreateDocument as jest.Mock).mock.calls.filter(
      (c: any[]) => c[1] === NOTES,
    );
    expect(noteCalls).toHaveLength(2);
  });
});
