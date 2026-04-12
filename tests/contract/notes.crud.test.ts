import { test, expect, jest, describe, beforeEach } from '@jest/globals';
import { makeContext, withAuth } from '../helpers/makeContext';

// ---------------------------------------------------------------------------
// Mock node-appwrite
// ---------------------------------------------------------------------------

const mockListDocuments = jest.fn() as any;
const mockCreateDocument = jest.fn() as any;
const mockUpdateDocument = jest.fn() as any;

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
  })),
  ID: { unique: () => 'generated-id' },
  Query: {
    equal: (field: string, value: string) => `${field}=${value}`,
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
const EVENTS = 'noteChangeEvents';
const USER = 'user-1';
const AUTH = withAuth(USER);

beforeEach(() => {
  jest.clearAllMocks();
  process.env.APPWRITE_FUNCTION_API_ENDPOINT = 'https://cloud.appwrite.io/v1';
  process.env.APPWRITE_FUNCTION_API_KEY = 'test-api-key';
  process.env.APPWRITE_FUNCTION_PROJECT_ID = 'test-project-id';
  mockListDocuments.mockResolvedValue({ documents: [] });
  mockCreateDocument.mockResolvedValue({});
  mockUpdateDocument.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// getNotes
// ---------------------------------------------------------------------------

describe('getNotes Contract', () => {
  test('should query notes for the given userId', async () => {
    const expectedDoc = {
      $id: 'note-1',
      id: 'note-1',
      userId: USER,
      title: 'Hello',
      active: true,
      updatedAt: 1000,
      createdAt: 1000,
      content: null,
      contentType: null,
      color: null,
      done: false,
      isPinned: false,
      triggerAt: null,
      repeatRule: null,
      repeatConfig: null,
      repeat: null,
      baseAtLocal: null,
      startAt: null,
      nextTriggerAt: null,
      lastFiredAt: null,
      lastAcknowledgedAt: null,
      snoozedUntil: null,
      scheduleStatus: null,
      timezone: null,
      deletedAt: null,
      version: 1,
    };
    mockListDocuments.mockResolvedValueOnce({ documents: [expectedDoc] });

    const { context, responses } = makeContext({
      method: 'GET',
      path: '/',
      headers: AUTH,
      query: { userId: USER },
    });
    await main(context as never);

    expect(mockListDocuments).toHaveBeenCalledWith(DB, NOTES, expect.any(Array));
    const result = responses[0].data as { notes: unknown[]; syncedAt: number };
    expect(result.notes).toHaveLength(1);
  });

  test('should return empty array when user has no notes', async () => {
    const { context, responses } = makeContext({
      method: 'GET',
      path: '/',
      headers: AUTH,
      query: { userId: USER },
    });
    await main(context as never);

    expect((responses[0].data as { notes: unknown[] }).notes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// syncNotes – create
// ---------------------------------------------------------------------------

describe('syncNotes Contract – create', () => {
  const baseNote = {
    id: 'note-new',
    userId: USER,
    title: 'My Note',
    content: 'Some content',
    color: null,
    active: true,
    done: false,
    isPinned: false,
    updatedAt: 2000,
    createdAt: 1000,
    operation: 'create',
    deviceId: 'device-1',
    version: 1,
    baseVersion: 0,
  };

  function callSync(changes: unknown[]) {
    return makeContext({
      method: 'POST',
      path: '/',
      headers: AUTH,
      body: JSON.stringify({ userId: USER, changes, lastSyncAt: 0 }),
    });
  }

  test('should insert a new note and emit a noteChangeEvent', async () => {
    const { context } = callSync([baseNote]);
    await main(context as never);

    expect(mockCreateDocument).toHaveBeenCalledWith(
      DB,
      NOTES,
      'note-new',
      expect.objectContaining({
        userId: USER,
        title: 'My Note',
        content: 'Some content',
        active: true,
        version: 1,
      }),
      expect.any(Array),
    );
    expect(mockCreateDocument).toHaveBeenCalledWith(
      DB,
      EVENTS,
      expect.any(String),
      expect.objectContaining({
        noteId: 'note-new',
        operation: 'create',
        userId: USER,
        deviceId: 'device-1',
      }),
      expect.any(Array),
    );
  });

  test('should return syncedAt timestamp and notes array', async () => {
    const { context, responses } = callSync([baseNote]);
    await main(context as never);

    const result = responses[0].data as { notes: unknown[]; syncedAt: number };
    expect(result).toHaveProperty('notes');
    expect(result).toHaveProperty('syncedAt');
    expect(typeof result.syncedAt).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// syncNotes – update
// ---------------------------------------------------------------------------

describe('syncNotes Contract – update', () => {
  const existingNote = {
    $id: 'note-1',
    id: 'note-1',
    userId: USER,
    title: 'Old Title',
    content: 'Old content',
    active: true,
    updatedAt: 1000,
    version: 2,
  };

  function callSync(changes: unknown[]) {
    return makeContext({
      method: 'POST',
      path: '/',
      headers: AUTH,
      body: JSON.stringify({ userId: USER, changes, lastSyncAt: 0 }),
    });
  }

  test('should patch note when incoming updatedAt is newer', async () => {
    mockListDocuments.mockResolvedValueOnce({ documents: [existingNote] });

    const { context } = callSync([
      {
        id: 'note-1',
        userId: USER,
        title: 'New Title',
        content: 'New content',
        active: true,
        updatedAt: 9999,
        createdAt: 1000,
        operation: 'update',
        deviceId: 'device-1',
      },
    ]);
    await main(context as never);

    expect(mockUpdateDocument).toHaveBeenCalledWith(
      DB,
      NOTES,
      'note-1',
      expect.objectContaining({
        title: 'New Title',
        content: 'New content',
        updatedAt: 9999,
        version: 3,
      }),
    );
  });

  test('should NOT patch note when incoming updatedAt is older', async () => {
    mockListDocuments.mockResolvedValueOnce({ documents: [existingNote] });

    const { context } = callSync([
      {
        id: 'note-1',
        userId: USER,
        title: 'Stale Title',
        content: 'Stale content',
        active: true,
        updatedAt: 500,
        createdAt: 1000,
        operation: 'update',
        deviceId: 'device-1',
      },
    ]);
    await main(context as never);

    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });

  test('should insert note when it does not exist on server during update', async () => {
    const { context } = callSync([
      {
        id: 'note-missing',
        userId: USER,
        title: 'Created via update',
        content: null,
        active: true,
        updatedAt: 3000,
        createdAt: 2000,
        operation: 'update',
        deviceId: 'device-2',
      },
    ]);
    await main(context as never);

    expect(mockCreateDocument).toHaveBeenCalledWith(
      DB,
      NOTES,
      'note-missing',
      expect.objectContaining({ userId: USER, version: 1 }),
      expect.any(Array),
    );
  });

  test('should not patch another users note when ids collide across users', async () => {
    const { context } = makeContext({
      method: 'POST',
      path: '/',
      headers: withAuth('user-2'),
      body: JSON.stringify({
        userId: 'user-2',
        changes: [
          {
            id: 'note-1',
            userId: 'user-2',
            title: 'Cross-user safe insert',
            active: true,
            updatedAt: 4000,
            createdAt: 2000,
            operation: 'update',
            deviceId: 'device-2',
          },
        ],
        lastSyncAt: 0,
      }),
    });
    await main(context as never);

    expect(mockUpdateDocument).not.toHaveBeenCalled();
    expect(mockCreateDocument).toHaveBeenCalledWith(
      DB,
      NOTES,
      'note-1',
      expect.objectContaining({ userId: 'user-2' }),
      expect.any(Array),
    );
  });

  test('should clear canonical recurrence fields when explicit null is provided', async () => {
    mockListDocuments.mockResolvedValueOnce({
      documents: [
        {
          ...existingNote,
          repeat: JSON.stringify({ kind: 'daily', interval: 1 }),
          startAt: 1111,
          baseAtLocal: '2026-01-01T09:00:00',
          nextTriggerAt: 2222,
          lastFiredAt: 3333,
          lastAcknowledgedAt: 4444,
        },
      ],
    });

    const { context } = callSync([
      {
        id: 'note-1',
        userId: USER,
        active: true,
        updatedAt: 9999,
        createdAt: 1000,
        operation: 'update',
        deviceId: 'device-1',
        repeat: null,
        startAt: null,
        baseAtLocal: null,
        nextTriggerAt: null,
        lastFiredAt: null,
        lastAcknowledgedAt: null,
      },
    ]);
    await main(context as never);

    expect(mockUpdateDocument).toHaveBeenCalledWith(
      DB,
      NOTES,
      'note-1',
      expect.objectContaining({
        repeat: null,
        startAt: null,
        baseAtLocal: null,
        nextTriggerAt: null,
        lastFiredAt: null,
        lastAcknowledgedAt: null,
      }),
    );
  });

  test('should send null for canonical recurrence fields when they are omitted', async () => {
    mockListDocuments.mockResolvedValueOnce({ documents: [existingNote] });

    const { context } = callSync([
      {
        id: 'note-1',
        userId: USER,
        title: 'No canonical touch',
        active: true,
        updatedAt: 9999,
        createdAt: 1000,
        operation: 'update',
        deviceId: 'device-1',
      },
    ]);
    await main(context as never);

    // Appwrite always sends all fields; omitted canonical fields become null
    expect(mockUpdateDocument).toHaveBeenCalledWith(
      DB,
      NOTES,
      'note-1',
      expect.objectContaining({
        repeat: null,
        startAt: null,
        baseAtLocal: null,
        nextTriggerAt: null,
        lastFiredAt: null,
        lastAcknowledgedAt: null,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// syncNotes – delete
// ---------------------------------------------------------------------------

describe('syncNotes Contract – delete', () => {
  function callSync(changes: unknown[]) {
    return makeContext({
      method: 'POST',
      path: '/',
      headers: AUTH,
      body: JSON.stringify({ userId: USER, changes, lastSyncAt: 0 }),
    });
  }

  test('should soft-delete an existing note', async () => {
    mockListDocuments.mockResolvedValueOnce({
      documents: [
        { $id: 'note-2', id: 'note-2', userId: USER, active: true, updatedAt: 1000, version: 1 },
      ],
    });

    const { context } = callSync([
      {
        id: 'note-2',
        userId: USER,
        active: false,
        updatedAt: 5000,
        createdAt: 1000,
        operation: 'delete',
        deviceId: 'device-1',
      },
    ]);
    await main(context as never);

    expect(mockUpdateDocument).toHaveBeenCalledWith(
      DB,
      NOTES,
      'note-2',
      expect.objectContaining({ active: false, updatedAt: 5000, version: 2 }),
    );
  });

  test('should emit a noteChangeEvent for delete operation', async () => {
    mockListDocuments.mockResolvedValueOnce({
      documents: [
        { $id: 'note-3', id: 'note-3', userId: USER, active: true, updatedAt: 1000, version: 1 },
      ],
    });

    const { context } = callSync([
      {
        id: 'note-3',
        userId: USER,
        active: false,
        updatedAt: 6000,
        createdAt: 1000,
        operation: 'delete',
        deviceId: 'device-1',
      },
    ]);
    await main(context as never);

    expect(mockCreateDocument).toHaveBeenCalledWith(
      DB,
      EVENTS,
      expect.any(String),
      expect.objectContaining({ noteId: 'note-3', operation: 'delete', userId: USER }),
      expect.any(Array),
    );
  });

  test('should skip patch when note to delete is not found', async () => {
    const { context } = callSync([
      {
        id: 'note-ghost',
        userId: USER,
        active: false,
        updatedAt: 7000,
        createdAt: 1000,
        operation: 'delete',
        deviceId: 'device-1',
      },
    ]);
    await main(context as never);

    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// syncNotes – batch operations
// ---------------------------------------------------------------------------

describe('syncNotes Contract – batch operations', () => {
  test('should process multiple changes in a single call', async () => {
    mockListDocuments
      .mockResolvedValueOnce({ documents: [] }) // create: no existing
      .mockResolvedValueOnce({
        documents: [{ $id: 'note-5', id: 'note-5', userId: USER, updatedAt: 100, version: 1 }],
      }) // update: existing
      .mockResolvedValue({ documents: [] }); // canonical state

    const { context } = makeContext({
      method: 'POST',
      path: '/',
      headers: AUTH,
      body: JSON.stringify({
        userId: USER,
        changes: [
          {
            id: 'note-4',
            userId: USER,
            title: 'Batch create',
            active: true,
            updatedAt: 2000,
            createdAt: 1000,
            operation: 'create',
            deviceId: 'device-1',
          },
          {
            id: 'note-5',
            userId: USER,
            title: 'Batch update',
            active: true,
            updatedAt: 9000,
            createdAt: 1000,
            operation: 'update',
            deviceId: 'device-1',
          },
        ],
        lastSyncAt: 0,
      }),
    });
    await main(context as never);

    const eventCalls = (mockCreateDocument as jest.Mock).mock.calls.filter(
      (c: unknown[]) => c[1] === EVENTS,
    );
    expect(eventCalls).toHaveLength(2);
    expect(mockCreateDocument).toHaveBeenCalledWith(
      DB,
      NOTES,
      'note-4',
      expect.objectContaining({ title: 'Batch create', active: true }),
      expect.any(Array),
    );
    expect(mockUpdateDocument).toHaveBeenCalledWith(
      DB,
      NOTES,
      'note-5',
      expect.objectContaining({ title: 'Batch update' }),
    );
  });
});

// ---------------------------------------------------------------------------
// syncNotes – checklist contentType
// ---------------------------------------------------------------------------

describe('syncNotes Contract – checklist contentType', () => {
  function callSync(changes: unknown[]) {
    return makeContext({
      method: 'POST',
      path: '/',
      headers: AUTH,
      body: JSON.stringify({ userId: USER, changes, lastSyncAt: 0 }),
    });
  }

  test('should create a note with contentType checklist and JSON content', async () => {
    const checklistContent = JSON.stringify([
      { id: 'c1', text: 'Buy milk', checked: false },
      { id: 'c2', text: 'Walk dog', checked: true },
    ]);

    const { context } = callSync([
      {
        id: 'note-checklist',
        userId: USER,
        title: 'Shopping List',
        content: checklistContent,
        contentType: 'checklist',
        active: true,
        done: false,
        updatedAt: 3000,
        createdAt: 2000,
        operation: 'create',
        deviceId: 'device-1',
      },
    ]);
    await main(context as never);

    expect(mockCreateDocument).toHaveBeenCalledWith(
      DB,
      NOTES,
      'note-checklist',
      expect.objectContaining({ content: checklistContent, contentType: 'checklist', version: 1 }),
      expect.any(Array),
    );
  });

  test('should update contentType when patching a note', async () => {
    mockListDocuments.mockResolvedValueOnce({
      documents: [
        {
          $id: 'note-clist',
          id: 'note-clist',
          userId: USER,
          content: 'plain text',
          contentType: null,
          updatedAt: 1000,
          version: 1,
        },
      ],
    });

    const checklistContent = JSON.stringify([{ id: 'c1', text: 'Item 1', checked: false }]);

    const { context } = callSync([
      {
        id: 'note-clist',
        userId: USER,
        content: checklistContent,
        contentType: 'checklist',
        active: true,
        updatedAt: 5000,
        createdAt: 1000,
        operation: 'update',
        deviceId: 'device-1',
      },
    ]);
    await main(context as never);

    expect(mockUpdateDocument).toHaveBeenCalledWith(
      DB,
      NOTES,
      'note-clist',
      expect.objectContaining({ content: checklistContent, contentType: 'checklist' }),
    );
  });
});
