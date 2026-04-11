import main from './main.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  query?: Record<string, string>;
}) {
  const responses: Array<{ data: unknown; status: number }> = [];
  const logs: string[] = [];
  const errors: string[] = [];

  const res = {
    json(data: unknown, statusCode = 200) {
      responses.push({ data, status: statusCode });
    },
  };

  const context = {
    req: {
      method: overrides.method ?? 'POST',
      path: '/',
      headers: overrides.headers ?? {},
      body: overrides.body ?? '{}',
      query: overrides.query ?? {},
    },
    res,
    log: (msg: string) => logs.push(msg),
    error: (msg: string) => errors.push(msg),
  };

  return { context, responses, logs, errors };
}

const VALID_USER_ID = 'user-123';

function withAuth(headers: Record<string, string> = {}): Record<string, string> {
  return { 'x-appwrite-user-id': VALID_USER_ID, ...headers };
}

// ---------------------------------------------------------------------------
// Test setup: mock node-appwrite and env
// ---------------------------------------------------------------------------

const mockListDocuments = jest.fn();
const mockCreateDocument = jest.fn();
const mockUpdateDocument = jest.fn();

jest.mock('node-appwrite', () => {
  return {
    Client: jest.fn().mockImplementation(() => ({
      setEndpoint: jest.fn().mockReturnThis(),
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
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.APPWRITE_FUNCTION_API_ENDPOINT = 'https://cloud.appwrite.io/v1';
  process.env.APPWRITE_FUNCTION_API_KEY = 'test-api-key';

  // Default: no existing notes
  mockListDocuments.mockResolvedValue({ documents: [] });
  mockCreateDocument.mockResolvedValue({});
  mockUpdateDocument.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// Auth tests
// ---------------------------------------------------------------------------

describe('auth', () => {
  it('returns 401 when x-appwrite-user-id header is missing', async () => {
    const { context, responses } = makeContext({ headers: {} });
    await main(context as never);
    expect(responses[0].status).toBe(401);
    expect((responses[0].data as { error: string }).error).toBe('Unauthorized');
  });

  it('returns 403 when body.userId does not match authenticated userId', async () => {
    const { context, responses } = makeContext({
      headers: withAuth(),
      body: JSON.stringify({
        userId: 'other-user',
        changes: [],
        lastSyncAt: 0,
      }),
    });
    await main(context as never);
    expect(responses[0].status).toBe(403);
  });

  it('returns 403 for GET when query userId does not match', async () => {
    const { context, responses } = makeContext({
      method: 'GET',
      headers: withAuth(),
      query: { userId: 'other-user' },
    });
    await main(context as never);
    expect(responses[0].status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Input validation tests
// ---------------------------------------------------------------------------

describe('input validation', () => {
  it('returns 400 for invalid JSON body', async () => {
    const { context, responses } = makeContext({
      headers: withAuth(),
      body: 'not-json',
    });
    await main(context as never);
    expect(responses[0].status).toBe(400);
  });

  it('returns 400 when changes is not an array', async () => {
    const { context, responses } = makeContext({
      headers: withAuth(),
      body: JSON.stringify({ userId: VALID_USER_ID, changes: 'bad', lastSyncAt: 0 }),
    });
    await main(context as never);
    expect(responses[0].status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// LWW (Last-Write-Wins) logic tests
// ---------------------------------------------------------------------------

describe('LWW conflict resolution', () => {
  it('does NOT update note when incoming updatedAt is older than existing', async () => {
    const existingDoc = {
      $id: 'note-1',
      userId: VALID_USER_ID,
      title: 'Server title',
      updatedAt: 1000,
      version: 2,
      active: true,
      done: false,
      isPinned: false,
    };

    // First call returns existing note, second call (canonical fetch) returns updated list
    mockListDocuments
      .mockResolvedValueOnce({ documents: [existingDoc] }) // change event check: not called
      .mockResolvedValueOnce({ documents: [existingDoc] }) // existing fetch
      .mockResolvedValueOnce({ documents: [existingDoc] }); // canonical fetch

    // We need the createDocument (change event) + then listDocuments for existing + final list
    // Reset and control more carefully
    mockCreateDocument.mockResolvedValue({});
    mockListDocuments
      .mockResolvedValueOnce({ documents: [existingDoc] }) // existing check in sync loop
      .mockResolvedValueOnce({ documents: [existingDoc] }); // final canonical fetch

    const { context, responses } = makeContext({
      headers: withAuth(),
      body: JSON.stringify({
        userId: VALID_USER_ID,
        changes: [
          {
            id: 'note-1',
            userId: VALID_USER_ID,
            title: 'Old title',
            active: true,
            updatedAt: 500, // older than existing.updatedAt = 1000
            createdAt: 100,
            operation: 'update',
            deviceId: 'test-device',
          },
        ],
        lastSyncAt: 0,
      }),
    });

    await main(context as never);

    expect(mockUpdateDocument).not.toHaveBeenCalled();
    expect(responses[0].status).toBe(200);
  });

  it('DOES update note when incoming updatedAt is newer than existing', async () => {
    const existingDoc = {
      $id: 'note-1',
      userId: VALID_USER_ID,
      title: 'Old title',
      updatedAt: 500,
      version: 1,
      active: true,
      done: false,
      isPinned: false,
    };

    mockListDocuments
      .mockResolvedValueOnce({ documents: [existingDoc] })
      .mockResolvedValueOnce({ documents: [existingDoc] });

    const { context, responses } = makeContext({
      headers: withAuth(),
      body: JSON.stringify({
        userId: VALID_USER_ID,
        changes: [
          {
            id: 'note-1',
            userId: VALID_USER_ID,
            title: 'New title',
            active: true,
            updatedAt: 1000, // newer
            createdAt: 100,
            operation: 'update',
            deviceId: 'test-device',
          },
        ],
        lastSyncAt: 0,
      }),
    });

    await main(context as never);

    expect(mockUpdateDocument).toHaveBeenCalledWith(
      DATABASE_ID,
      NOTES_COLLECTION,
      'note-1',
      expect.objectContaining({ title: 'New title', updatedAt: 1000, version: 2 }),
    );
    expect(responses[0].status).toBe(200);
  });
});

const DATABASE_ID = 'ai-note-keeper';
const NOTES_COLLECTION = 'notes';

// ---------------------------------------------------------------------------
// Sync flow tests
// ---------------------------------------------------------------------------

describe('sync flow', () => {
  it('creates a new note when it does not exist', async () => {
    mockListDocuments
      .mockResolvedValueOnce({ documents: [] }) // existing check
      .mockResolvedValueOnce({ documents: [] }); // final fetch

    const { context, responses } = makeContext({
      headers: withAuth(),
      body: JSON.stringify({
        userId: VALID_USER_ID,
        changes: [
          {
            id: 'new-note',
            userId: VALID_USER_ID,
            title: 'Brand new',
            active: true,
            updatedAt: 1000,
            createdAt: 900,
            operation: 'create',
            deviceId: 'device-1',
          },
        ],
        lastSyncAt: 0,
      }),
    });

    await main(context as never);

    expect(mockCreateDocument).toHaveBeenCalledWith(
      DATABASE_ID,
      NOTES_COLLECTION,
      'new-note',
      expect.objectContaining({ title: 'Brand new', userId: VALID_USER_ID, version: 1 }),
    );
    expect(responses[0].status).toBe(200);
  });

  it('soft-deletes a note on delete operation', async () => {
    const existingDoc = {
      $id: 'note-del',
      userId: VALID_USER_ID,
      active: true,
      updatedAt: 100,
      version: 1,
      done: false,
      isPinned: false,
    };

    mockListDocuments
      .mockResolvedValueOnce({ documents: [existingDoc] })
      .mockResolvedValueOnce({ documents: [] });

    const { context, responses } = makeContext({
      headers: withAuth(),
      body: JSON.stringify({
        userId: VALID_USER_ID,
        changes: [
          {
            id: 'note-del',
            userId: VALID_USER_ID,
            active: false,
            updatedAt: 200,
            createdAt: 50,
            operation: 'delete',
            deviceId: 'device-1',
          },
        ],
        lastSyncAt: 0,
      }),
    });

    await main(context as never);

    expect(mockUpdateDocument).toHaveBeenCalledWith(
      DATABASE_ID,
      NOTES_COLLECTION,
      'note-del',
      expect.objectContaining({ active: false }),
    );
    expect(responses[0].status).toBe(200);
  });
});
