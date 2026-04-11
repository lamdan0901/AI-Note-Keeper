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
const mockCreateDocument = jest.fn();
const mockUpdateDocument = jest.fn();
const mockCreateExecution = jest.fn();

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
  Functions: jest.fn().mockImplementation(() => ({
    createExecution: mockCreateExecution,
  })),
  ID: { unique: jest.fn().mockReturnValue('gen-id') },
  Query: {
    equal: jest.fn((f, v) => `${f}=${v}`),
    greaterThanEqual: jest.fn((f, v) => `${f}>=${v}`),
    lessThanEqual: jest.fn((f, v) => `${f}<=${v}`),
    limit: jest.fn((n) => `limit=${n}`),
    or: jest.fn((...args) => ({ or: args })),
    and: jest.fn((...args) => ({ and: args })),
  },
}));

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  process.env.APPWRITE_FUNCTION_API_ENDPOINT = 'https://cloud.appwrite.io/v1';
  process.env.APPWRITE_FUNCTION_API_KEY = 'test-api-key';
  process.env.APPWRITE_FUNCTION_PROJECT_ID = 'test-project-id';
  process.env.PUSH_FUNCTION_ID = 'push-fn-id';

  mockListDocuments.mockResolvedValue({ documents: [] });
  mockCreateDocument.mockResolvedValue({ $id: 'state-doc' });
  mockUpdateDocument.mockResolvedValue({});
  mockCreateExecution.mockResolvedValue({ $id: 'exec-1' });
});

function makeNote(overrides: Record<string, unknown> = {}) {
  return {
    $id: 'note-1',
    userId: 'user-1',
    title: 'Test reminder',
    active: true,
    triggerAt: null,
    nextTriggerAt: null,
    snoozedUntil: null,
    startAt: null,
    baseAtLocal: null,
    repeat: null,
    timezone: 'UTC',
    scheduleStatus: 'scheduled',
    ...overrides,
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
// No due notes
// ---------------------------------------------------------------------------

describe('no due notes', () => {
  it('returns triggered=0 when there are no due reminders', async () => {
    // First listDocuments call = watermark (returns empty), second = due notes
    mockListDocuments
      .mockResolvedValueOnce({ documents: [] }) // watermark
      .mockResolvedValueOnce({ documents: [] }); // due notes

    const { context, responses } = makeContext();
    await main(context as never);

    expect(responses[0].status).toBe(200);
    const data = responses[0].data as { triggered: number; checked: number };
    expect(data.triggered).toBe(0);
    expect(data.checked).toBe(0);
    expect(mockCreateExecution).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Due note via nextTriggerAt
// ---------------------------------------------------------------------------

describe('due note via nextTriggerAt', () => {
  it('fires push and marks note unscheduled for one-off reminder', async () => {
    const note = makeNote({ nextTriggerAt: Date.now() - 1000 });

    mockListDocuments
      .mockResolvedValueOnce({ documents: [] }) // watermark
      .mockResolvedValueOnce({ documents: [note] }); // due notes

    const { context, responses } = makeContext();
    await main(context as never);

    const data = responses[0].data as { triggered: number };
    expect(data.triggered).toBe(1);

    // Push was fired
    expect(mockCreateExecution).toHaveBeenCalledWith(
      'push-fn-id',
      expect.stringContaining('"isTrigger":true'),
      true,
    );

    // Note was updated with unscheduled status
    const updateArgs = mockUpdateDocument.mock.calls[0][3] as Record<string, unknown>;
    expect(updateArgs.scheduleStatus).toBe('unscheduled');
    expect(updateArgs.nextTriggerAt).toBeNull();
    expect(updateArgs.snoozedUntil).toBeNull();
  });

  it('includes correct noteId/userId in push payload', async () => {
    const note = makeNote({ $id: 'note-xyz', userId: 'user-abc', nextTriggerAt: Date.now() - 500 });

    mockListDocuments
      .mockResolvedValueOnce({ documents: [] })
      .mockResolvedValueOnce({ documents: [note] });

    const { context } = makeContext();
    await main(context as never);

    const execBody = JSON.parse(mockCreateExecution.mock.calls[0][1] as string) as {
      userId: string;
      reminderId: string;
    };
    expect(execBody.userId).toBe('user-abc');
    expect(execBody.reminderId).toBe('note-xyz');
  });
});

// ---------------------------------------------------------------------------
// Due note via snoozedUntil
// ---------------------------------------------------------------------------

describe('due note via snoozedUntil', () => {
  it('fires push for snoozed reminder and clears snoozedUntil', async () => {
    const note = makeNote({ snoozedUntil: Date.now() - 2000, nextTriggerAt: Date.now() + 99999 });

    mockListDocuments
      .mockResolvedValueOnce({ documents: [] })
      .mockResolvedValueOnce({ documents: [note] });

    const { context, responses } = makeContext();
    await main(context as never);

    const data = responses[0].data as { triggered: number };
    expect(data.triggered).toBe(1);

    const updateArgs = mockUpdateDocument.mock.calls[0][3] as Record<string, unknown>;
    expect(updateArgs.snoozedUntil).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Legacy triggerAt only
// ---------------------------------------------------------------------------

describe('legacy triggerAt-only note', () => {
  it('fires for notes with only triggerAt (no nextTriggerAt)', async () => {
    const note = makeNote({
      triggerAt: Date.now() - 3000,
      nextTriggerAt: null,
      snoozedUntil: null,
    });

    mockListDocuments
      .mockResolvedValueOnce({ documents: [] })
      .mockResolvedValueOnce({ documents: [note] });

    const { context, responses } = makeContext();
    await main(context as never);

    const data = responses[0].data as { triggered: number };
    expect(data.triggered).toBe(1);
    expect(mockCreateExecution).toHaveBeenCalledWith(
      'push-fn-id',
      expect.stringContaining('"isTrigger":true'),
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Recurring note
// ---------------------------------------------------------------------------

describe('recurring note', () => {
  it('advances nextTriggerAt and keeps scheduleStatus=scheduled for daily repeat', async () => {
    const futureStart = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days ago
    const note = makeNote({
      nextTriggerAt: Date.now() - 1000,
      startAt: futureStart,
      baseAtLocal: '2025-01-01T09:00:00',
      repeat: JSON.stringify({ kind: 'daily', interval: 1 }),
      timezone: 'UTC',
    });

    mockListDocuments
      .mockResolvedValueOnce({ documents: [] })
      .mockResolvedValueOnce({ documents: [note] });

    const { context } = makeContext();
    await main(context as never);

    const updateArgs = mockUpdateDocument.mock.calls[0][3] as Record<string, unknown>;
    expect(updateArgs.scheduleStatus).toBe('scheduled');
    expect(typeof updateArgs.nextTriggerAt).toBe('number');
    // nextTriggerAt should be in the future
    expect(updateArgs.nextTriggerAt as number).toBeGreaterThan(Date.now());
    expect(updateArgs.lastFiredAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Watermark
// ---------------------------------------------------------------------------

describe('watermark', () => {
  it('reads existing watermark and creates new when absent', async () => {
    mockListDocuments
      .mockResolvedValueOnce({ documents: [] }) // no watermark
      .mockResolvedValueOnce({ documents: [] }); // no due notes

    const { context } = makeContext();
    await main(context as never);

    // Watermark was created via createDocument
    expect(mockCreateDocument).toHaveBeenCalledWith(
      'ai-note-keeper',
      'cronState',
      expect.any(String),
      expect.objectContaining({ key: 'check-reminders' }),
    );
  });

  it('updates existing watermark doc', async () => {
    const watermarkDoc = { $id: 'wm-doc', key: 'check-reminders', watermark: Date.now() - 60000 };

    mockListDocuments
      .mockResolvedValueOnce({ documents: [watermarkDoc] }) // existing watermark
      .mockResolvedValueOnce({ documents: [] }); // no due notes

    const { context } = makeContext();
    await main(context as never);

    expect(mockUpdateDocument).toHaveBeenCalledWith(
      'ai-note-keeper',
      'cronState',
      'wm-doc',
      expect.objectContaining({ watermark: expect.any(Number) }),
    );
  });
});
