import main from './main.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext() {
  const responses: Array<{ data: unknown; status: number }> = [];
  const context = {
    req: { method: 'POST', path: '/', headers: {}, body: '{}', query: {} },
    res: {
      json(data: unknown, statusCode = 200) {
        responses.push({ data, status: statusCode });
      },
    },
    log: jest.fn(),
    error: jest.fn(),
  };
  return { context, responses };
}

// ---------------------------------------------------------------------------
// Mocks — node-appwrite
// ---------------------------------------------------------------------------

const mockListDocuments = jest.fn();
const mockDeleteDocument = jest.fn();

jest.mock('node-appwrite', () => ({
  Client: jest.fn().mockImplementation(() => ({
    setEndpoint: jest.fn().mockReturnThis(),
    setProject: jest.fn().mockReturnThis(),
    setKey: jest.fn().mockReturnThis(),
  })),
  Databases: jest.fn().mockImplementation(() => ({
    listDocuments: mockListDocuments,
    deleteDocument: mockDeleteDocument,
  })),
  Query: {
    equal: jest.fn((f, v) => `${f}=${v}`),
    lessThan: jest.fn((f, v) => `${f}<${v}`),
    limit: jest.fn((n) => `limit=${n}`),
  },
}));

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.APPWRITE_FUNCTION_API_ENDPOINT = 'https://cloud.appwrite.io/v1';
  process.env.APPWRITE_FUNCTION_API_KEY = 'test-api-key';
  process.env.APPWRITE_FUNCTION_PROJECT_ID = 'test-project-id';

  mockListDocuments.mockResolvedValue({ documents: [] });
  mockDeleteDocument.mockResolvedValue({});
});

function staleDoc(id: string, collection: 'notes' | 'subscriptions' = 'notes') {
  return {
    $id: id,
    active: false,
    deletedAt: Date.now() - FOURTEEN_DAYS_MS - 60000, // 14 days + 1 min ago
    collection,
  };
}

// ---------------------------------------------------------------------------
// Env validation
// ---------------------------------------------------------------------------

describe('env validation', () => {
  it('returns 500 when APPWRITE_FUNCTION_API_ENDPOINT is missing', async () => {
    delete process.env.APPWRITE_FUNCTION_API_ENDPOINT;
    const { context, responses } = makeContext();
    await main(context as never);
    expect(responses[0].status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Notes purge
// ---------------------------------------------------------------------------

describe('notes purge', () => {
  it('returns notesPurged=0 when no expired notes exist', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    const { context, responses } = makeContext();
    await main(context as never);

    const data = responses[0].data as { notesPurged: number; subscriptionsPurged: number };
    expect(data.notesPurged).toBe(0);
  });

  it('deletes notes older than 14 days from trash', async () => {
    mockListDocuments
      .mockResolvedValueOnce({ documents: [staleDoc('note-old')] }) // notes page 1 (1 < 500 → stops)
      .mockResolvedValueOnce({ documents: [] }); // subs page 1

    const { context, responses } = makeContext();
    await main(context as never);

    expect(mockDeleteDocument).toHaveBeenCalledWith('ai-note-keeper', 'notes', 'note-old');
    const data = responses[0].data as { notesPurged: number };
    expect(data.notesPurged).toBe(1);
  });

  it('does NOT delete recent trash notes (deleted < 14 days ago)', async () => {
    // listDocuments returns empty = no expired notes found (simulates cutoff filtering)
    mockListDocuments.mockResolvedValue({ documents: [] });

    const { context, responses } = makeContext();
    await main(context as never);

    expect(mockDeleteDocument).not.toHaveBeenCalled();
    const data = responses[0].data as { notesPurged: number };
    expect(data.notesPurged).toBe(0);
  });

  it('continues pagination until empty page for notes', async () => {
    // Return 500 docs on first call (full page), empty on second
    const PAGE_LIMIT = 500;
    const page1 = Array.from({ length: PAGE_LIMIT }, (_, i) => staleDoc(`note-${i}`));

    mockListDocuments
      .mockResolvedValueOnce({ documents: page1 }) // notes page 1 (full)
      .mockResolvedValueOnce({ documents: [] }) // notes page 2 (empty)
      .mockResolvedValueOnce({ documents: [] }); // subscriptions page 1

    const { context, responses } = makeContext();
    await main(context as never);

    const data = responses[0].data as { notesPurged: number };
    expect(data.notesPurged).toBe(PAGE_LIMIT);
    expect(mockDeleteDocument).toHaveBeenCalledTimes(PAGE_LIMIT);
  });
});

// ---------------------------------------------------------------------------
// Subscriptions purge
// ---------------------------------------------------------------------------

describe('subscriptions purge', () => {
  it('deletes expired subscriptions from trash', async () => {
    mockListDocuments
      .mockResolvedValueOnce({ documents: [] }) // notes page 1 empty (stops immediately)
      .mockResolvedValueOnce({ documents: [staleDoc('sub-old', 'subscriptions')] }); // subs page 1 (stops)

    const { context, responses } = makeContext();
    await main(context as never);

    expect(mockDeleteDocument).toHaveBeenCalledWith('ai-note-keeper', 'subscriptions', 'sub-old');
    const data = responses[0].data as { subscriptionsPurged: number };
    expect(data.subscriptionsPurged).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Mixed purge
// ---------------------------------------------------------------------------

describe('mixed purge', () => {
  it('returns both counts when both collections have expired items', async () => {
    mockListDocuments
      .mockResolvedValueOnce({ documents: [staleDoc('n1'), staleDoc('n2')] }) // notes page 1 (< 500 → loop stops)
      .mockResolvedValueOnce({ documents: [staleDoc('s1', 'subscriptions')] }); // subs page 1 (< 500 → loop stops)

    const { context, responses } = makeContext();
    await main(context as never);

    const data = responses[0].data as { notesPurged: number; subscriptionsPurged: number };
    expect(data.notesPurged).toBe(2);
    expect(data.subscriptionsPurged).toBe(1);
  });
});
