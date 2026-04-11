import main from './main.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
  query?: Record<string, string>;
}) {
  const responses: Array<{ data: unknown; status: number }> = [];

  const res = {
    json(data: unknown, statusCode = 200) {
      responses.push({ data, status: statusCode });
    },
  };

  const context = {
    req: {
      method: overrides.method ?? 'GET',
      path: overrides.path ?? '/',
      headers: overrides.headers ?? {},
      body: overrides.body ?? '{}',
      query: overrides.query ?? {},
    },
    res,
    log: jest.fn(),
    error: jest.fn(),
  };

  return { context, responses };
}

const VALID_USER_ID = 'user-abc';

function withAuth(extra: Record<string, string> = {}): Record<string, string> {
  return { 'x-appwrite-user-id': VALID_USER_ID, ...extra };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockListDocuments = jest.fn();
const mockCreateDocument = jest.fn();
const mockUpdateDocument = jest.fn();
const mockDeleteDocument = jest.fn();
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
}));

const sampleDoc = {
  $id: 'reminder-1',
  userId: VALID_USER_ID,
  title: 'Test reminder',
  triggerAt: 2000,
  repeatRule: 'none',
  repeatConfig: null,
  repeat: null,
  baseAtLocal: null,
  startAt: null,
  nextTriggerAt: 2000,
  lastFiredAt: null,
  lastAcknowledgedAt: null,
  snoozedUntil: null,
  active: true,
  scheduleStatus: 'scheduled',
  timezone: 'UTC',
  version: 1,
  updatedAt: 1000,
  createdAt: 900,
  done: false,
  isPinned: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.APPWRITE_FUNCTION_API_ENDPOINT = 'https://cloud.appwrite.io/v1';
  process.env.APPWRITE_FUNCTION_API_KEY = 'test-key';
  process.env.APPWRITE_FUNCTION_PROJECT_ID = 'test-project-id';
  process.env.PUSH_FUNCTION_ID = 'push-fn-id';

  mockCreateExecution.mockResolvedValue({ $id: 'exec-1' });
  mockListDocuments.mockResolvedValue({ documents: [] });
  mockCreateDocument.mockImplementation((_db, _col, id, data) =>
    Promise.resolve({ $id: id, ...data }),
  );
  mockUpdateDocument.mockImplementation((_db, _col, id, data) =>
    Promise.resolve({ ...sampleDoc, $id: id, ...data }),
  );
  mockDeleteDocument.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// Auth tests
// ---------------------------------------------------------------------------

describe('auth', () => {
  it('returns 401 when x-appwrite-user-id header is absent', async () => {
    const { context, responses } = makeContext({});
    await main(context as never);
    expect(responses[0].status).toBe(401);
  });

  it('returns 403 when createReminder body.userId mismatches auth userId', async () => {
    const { context, responses } = makeContext({
      method: 'POST',
      path: '/',
      headers: withAuth(),
      body: JSON.stringify({ userId: 'other', triggerAt: 1000, active: true, timezone: 'UTC' }),
    });
    await main(context as never);
    expect(responses[0].status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// listReminders
// ---------------------------------------------------------------------------

describe('listReminders (GET /)', () => {
  it('returns empty array when no reminders exist', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });
    const { context, responses } = makeContext({ method: 'GET', path: '/', headers: withAuth() });
    await main(context as never);
    expect(responses[0].status).toBe(200);
    expect(responses[0].data).toEqual([]);
  });

  it('filters out notes without triggerAt', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [
        { ...sampleDoc, triggerAt: null },
        { ...sampleDoc, $id: 'r2', triggerAt: 3000 },
      ],
    });
    const { context, responses } = makeContext({ method: 'GET', path: '/', headers: withAuth() });
    await main(context as never);
    const reminders = responses[0].data as unknown[];
    expect(reminders).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getReminder
// ---------------------------------------------------------------------------

describe('getReminder (GET /:id)', () => {
  it('returns 404 when reminder not found', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });
    const { context, responses } = makeContext({
      method: 'GET',
      path: '/reminder-1',
      headers: withAuth(),
    });
    await main(context as never);
    expect(responses[0].status).toBe(404);
  });

  it('returns reminder when found', async () => {
    mockListDocuments.mockResolvedValue({ documents: [sampleDoc] });
    const { context, responses } = makeContext({
      method: 'GET',
      path: '/reminder-1',
      headers: withAuth(),
    });
    await main(context as never);
    expect(responses[0].status).toBe(200);
    expect((responses[0].data as { id: string }).id).toBe('reminder-1');
  });
});

// ---------------------------------------------------------------------------
// createReminder
// ---------------------------------------------------------------------------

describe('createReminder (POST /)', () => {
  it('creates and returns reminder with status 201', async () => {
    const { context, responses } = makeContext({
      method: 'POST',
      path: '/',
      headers: withAuth(),
      body: JSON.stringify({
        userId: VALID_USER_ID,
        triggerAt: 5000,
        active: true,
        timezone: 'UTC',
      }),
    });
    await main(context as never);
    expect(responses[0].status).toBe(201);
  });

  it('computes nextTriggerAt for recurring reminders', async () => {
    // start in the future so computeNextTrigger returns startAt
    const futureStart = Date.now() + 3600000; // 1h from now

    const { context, responses } = makeContext({
      method: 'POST',
      path: '/',
      headers: withAuth(),
      body: JSON.stringify({
        userId: VALID_USER_ID,
        triggerAt: futureStart,
        startAt: futureStart,
        baseAtLocal: '2030-01-01T09:00:00',
        repeat: { kind: 'daily', interval: 1 },
        active: true,
        timezone: 'UTC',
      }),
    });
    await main(context as never);
    expect(responses[0].status).toBe(201);
    const created = mockCreateDocument.mock.calls.find((call) => call[1] === 'notes');
    expect(created).toBeDefined();
    expect(created[3].nextTriggerAt).toBe(futureStart);
  });

  it('calls functions.createExecution with reminder push payload after create', async () => {
    const { context, responses } = makeContext({
      method: 'POST',
      path: '/',
      headers: withAuth(),
      body: JSON.stringify({
        userId: VALID_USER_ID,
        triggerAt: 5000,
        active: true,
        timezone: 'UTC',
      }),
    });
    await main(context as never);
    expect(responses[0].status).toBe(201);
    expect(mockCreateExecution).toHaveBeenCalledWith(
      'push-fn-id',
      expect.stringContaining('"type":"reminder"'),
      true,
    );
    const execBody = JSON.parse(mockCreateExecution.mock.calls[0][1] as string) as {
      type: string;
      userId: string;
      isTrigger: boolean;
    };
    expect(execBody.type).toBe('reminder');
    expect(execBody.userId).toBe(VALID_USER_ID);
    expect(execBody.isTrigger).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deleteReminder
// ---------------------------------------------------------------------------

describe('deleteReminder (DELETE /:id)', () => {
  it('returns 404 when reminder does not exist', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });
    const { context, responses } = makeContext({
      method: 'DELETE',
      path: '/reminder-x',
      headers: withAuth(),
    });
    await main(context as never);
    expect(responses[0].status).toBe(404);
  });

  it('deletes reminder and returns id', async () => {
    mockListDocuments.mockResolvedValue({ documents: [sampleDoc] });
    const { context, responses } = makeContext({
      method: 'DELETE',
      path: '/reminder-1',
      headers: withAuth(),
    });
    await main(context as never);
    expect(responses[0].status).toBe(200);
    expect((responses[0].data as { id: string }).id).toBe('reminder-1');
    expect(mockDeleteDocument).toHaveBeenCalledWith('ai-note-keeper', 'notes', 'reminder-1');
  });
});

// ---------------------------------------------------------------------------
// ackReminder
// ---------------------------------------------------------------------------

describe('ackReminder (POST /:id/ack)', () => {
  it('returns 404 when reminder not found', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });
    const { context, responses } = makeContext({
      method: 'POST',
      path: '/reminder-1/ack',
      headers: withAuth(),
      body: JSON.stringify({ ackType: 'done' }),
    });
    await main(context as never);
    expect(responses[0].status).toBe(404);
  });

  it('computes nextTriggerAt for recurring reminder on ack', () => {
    // We verify computeNextTrigger integration by providing a recurring doc
    // and checking that the update sets a non-null nextTriggerAt
    const futureStart = Date.now() + 3600000;
    const recurringDoc = {
      ...sampleDoc,
      repeat: JSON.stringify({ kind: 'daily', interval: 1 }),
      startAt: futureStart,
      baseAtLocal: '2030-01-01T09:00:00',
      snoozedUntil: null,
    };

    mockListDocuments.mockResolvedValue({ documents: [recurringDoc] });

    const { context } = makeContext({
      method: 'POST',
      path: '/reminder-1/ack',
      headers: withAuth(),
      body: JSON.stringify({ ackType: 'done' }),
    });

    // Just verify it doesn't throw and calls updateDocument
    return main(context as never).then(() => {
      expect(mockUpdateDocument).toHaveBeenCalled();
      const updateArgs = mockUpdateDocument.mock.calls[0][3] as Record<string, unknown>;
      // For a future startAt, computeNextTrigger returns startAt itself
      expect(updateArgs['nextTriggerAt']).toBe(futureStart);
    });
  });

  it('marks one-off reminder as unscheduled on ack done', async () => {
    mockListDocuments.mockResolvedValue({ documents: [sampleDoc] });
    const { context } = makeContext({
      method: 'POST',
      path: '/reminder-1/ack',
      headers: withAuth(),
      body: JSON.stringify({ ackType: 'done' }),
    });
    await main(context as never);
    const updateArgs = mockUpdateDocument.mock.calls[0][3] as Record<string, unknown>;
    expect(updateArgs['scheduleStatus']).toBe('unscheduled');
    expect(updateArgs['nextTriggerAt']).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// snoozeReminder
// ---------------------------------------------------------------------------

describe('snoozeReminder (POST /:id/snooze)', () => {
  it('returns 400 when snoozedUntil missing', async () => {
    mockListDocuments.mockResolvedValue({ documents: [sampleDoc] });
    const { context, responses } = makeContext({
      method: 'POST',
      path: '/reminder-1/snooze',
      headers: withAuth(),
      body: JSON.stringify({}),
    });
    await main(context as never);
    expect(responses[0].status).toBe(400);
  });

  it('updates snoozedUntil and nextTriggerAt', async () => {
    mockListDocuments.mockResolvedValue({ documents: [sampleDoc] });
    const snoozeTime = Date.now() + 900000; // 15min
    const { context, responses } = makeContext({
      method: 'POST',
      path: '/reminder-1/snooze',
      headers: withAuth(),
      body: JSON.stringify({ snoozedUntil: snoozeTime }),
    });
    await main(context as never);
    expect(responses[0].status).toBe(200);
    const updateArgs = mockUpdateDocument.mock.calls[0][3] as Record<string, unknown>;
    expect(updateArgs['snoozedUntil']).toBe(snoozeTime);
    expect(updateArgs['nextTriggerAt']).toBe(snoozeTime);
    expect(updateArgs['scheduleStatus']).toBe('scheduled');
  });
});
