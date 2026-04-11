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
      path: overrides.path ?? '/subscriptions',
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
  ID: { unique: () => 'gen-id' },
  Query: {
    equal: (field: string, value: unknown) => `${field}=${String(value)}`,
  },
}));

// Base subscription doc as stored in Appwrite (reminderDaysBefore is a JSON string)
const sampleDoc = {
  $id: 'sub-1',
  userId: VALID_USER_ID,
  serviceName: 'Netflix',
  category: 'entertainment',
  price: 15.99,
  currency: 'USD',
  billingCycle: 'monthly',
  billingCycleCustomDays: null,
  nextBillingDate: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days from now
  trialEndDate: null,
  status: 'active',
  reminderDaysBefore: '[3,7]',
  nextReminderAt: null,
  nextTrialReminderAt: null,
  lastNotifiedBillingDate: null,
  lastNotifiedTrialEndDate: null,
  active: true,
  deletedAt: null,
  createdAt: 1000,
  updatedAt: 2000,
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.APPWRITE_FUNCTION_API_ENDPOINT = 'https://cloud.appwrite.io/v1';
  process.env.APPWRITE_FUNCTION_API_KEY = 'test-key';
  process.env.APPWRITE_FUNCTION_PROJECT_ID = 'test-project';

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
// Auth
// ---------------------------------------------------------------------------

describe('auth', () => {
  it('returns 401 when x-appwrite-user-id header is absent', async () => {
    const { context, responses } = makeContext({});
    await main(context as never);
    expect(responses[0].status).toBe(401);
  });

  it('returns 403 when createSubscription body.userId mismatches session userId', async () => {
    const { context, responses } = makeContext({
      method: 'POST',
      path: '/subscriptions',
      headers: withAuth(),
      body: JSON.stringify({
        userId: 'other-user',
        serviceName: 'Spotify',
        category: 'music',
        price: 9.99,
        currency: 'USD',
        billingCycle: 'monthly',
        nextBillingDate: Date.now() + 30000,
        status: 'active',
        reminderDaysBefore: [3],
      }),
    });
    await main(context as never);
    expect(responses[0].status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// createSubscription — computes nextReminderAt and nextTrialReminderAt
// ---------------------------------------------------------------------------

describe('createSubscription (POST /subscriptions)', () => {
  it('returns 201 with id on success', async () => {
    const futureDate = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const { context, responses } = makeContext({
      method: 'POST',
      path: '/subscriptions',
      headers: withAuth(),
      body: JSON.stringify({
        userId: VALID_USER_ID,
        serviceName: 'Netflix',
        category: 'entertainment',
        price: 15.99,
        currency: 'USD',
        billingCycle: 'monthly',
        nextBillingDate: futureDate,
        status: 'active',
        reminderDaysBefore: [3, 7],
      }),
    });
    await main(context as never);
    expect(responses[0].status).toBe(201);
    expect((responses[0].data as { id: string }).id).toBe('gen-id');
  });

  it('computes nextReminderAt from nextBillingDate and reminderDaysBefore', async () => {
    const futureDate = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days out
    const { context, responses } = makeContext({
      method: 'POST',
      path: '/subscriptions',
      headers: withAuth(),
      body: JSON.stringify({
        userId: VALID_USER_ID,
        serviceName: 'Netflix',
        category: 'entertainment',
        price: 15.99,
        currency: 'USD',
        billingCycle: 'monthly',
        nextBillingDate: futureDate,
        status: 'active',
        reminderDaysBefore: [7], // reminder 7 days before billing
      }),
    });
    await main(context as never);
    expect(responses[0].status).toBe(201);
    const createCall = mockCreateDocument.mock.calls[0];
    const docFields = createCall[3] as Record<string, unknown>;
    // nextReminderAt should be 7 days before the billing date
    expect(docFields['nextReminderAt']).toBe(futureDate - 7 * 24 * 60 * 60 * 1000);
  });

  it('computes nextTrialReminderAt when trialEndDate is provided', async () => {
    const futureDate = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const trialDate = Date.now() + 14 * 24 * 60 * 60 * 1000; // 14 days out
    const { context, responses } = makeContext({
      method: 'POST',
      path: '/subscriptions',
      headers: withAuth(),
      body: JSON.stringify({
        userId: VALID_USER_ID,
        serviceName: 'Netflix',
        category: 'entertainment',
        price: 0,
        currency: 'USD',
        billingCycle: 'monthly',
        nextBillingDate: futureDate,
        trialEndDate: trialDate,
        status: 'active',
        reminderDaysBefore: [3],
      }),
    });
    await main(context as never);
    expect(responses[0].status).toBe(201);
    const createCall = mockCreateDocument.mock.calls[0];
    const docFields = createCall[3] as Record<string, unknown>;
    // nextTrialReminderAt should be 3 days before the trial end date
    expect(docFields['nextTrialReminderAt']).toBe(trialDate - 3 * 24 * 60 * 60 * 1000);
  });

  it('serializes reminderDaysBefore as JSON string', async () => {
    const futureDate = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const { context } = makeContext({
      method: 'POST',
      path: '/subscriptions',
      headers: withAuth(),
      body: JSON.stringify({
        userId: VALID_USER_ID,
        serviceName: 'Spotify',
        category: 'music',
        price: 9.99,
        currency: 'USD',
        billingCycle: 'monthly',
        nextBillingDate: futureDate,
        status: 'active',
        reminderDaysBefore: [1, 3, 7],
      }),
    });
    await main(context as never);
    const createCall = mockCreateDocument.mock.calls[0];
    const docFields = createCall[3] as Record<string, unknown>;
    expect(docFields['reminderDaysBefore']).toBe('[1,3,7]');
  });
});

// ---------------------------------------------------------------------------
// updateSubscription — recomputes billing timestamps
// ---------------------------------------------------------------------------

describe('updateSubscription (PATCH /subscriptions/:id)', () => {
  it('returns 404 when subscription not found', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });
    const { context, responses } = makeContext({
      method: 'PATCH',
      path: '/subscriptions/sub-1',
      headers: withAuth(),
      body: JSON.stringify({ price: 20 }),
    });
    await main(context as never);
    expect(responses[0].status).toBe(404);
  });

  it('recomputes nextReminderAt when nextBillingDate changes', async () => {
    mockListDocuments.mockResolvedValue({ documents: [sampleDoc] });
    const newBillingDate = Date.now() + 60 * 24 * 60 * 60 * 1000; // 60 days out
    const { context, responses } = makeContext({
      method: 'PATCH',
      path: '/subscriptions/sub-1',
      headers: withAuth(),
      body: JSON.stringify({ nextBillingDate: newBillingDate }),
    });
    await main(context as never);
    expect(responses[0].status).toBe(200);
    const updateCall = mockUpdateDocument.mock.calls[0];
    const patch = updateCall[3] as Record<string, unknown>;
    // reminderDaysBefore is [3,7] from sampleDoc, earliest reminder is 7 days before
    expect(patch['nextReminderAt']).toBe(newBillingDate - 7 * 24 * 60 * 60 * 1000);
  });

  it('recomputes nextReminderAt when reminderDaysBefore changes', async () => {
    mockListDocuments.mockResolvedValue({ documents: [sampleDoc] });
    const existingBillingDate = sampleDoc.nextBillingDate;
    const { context, responses } = makeContext({
      method: 'PATCH',
      path: '/subscriptions/sub-1',
      headers: withAuth(),
      body: JSON.stringify({ reminderDaysBefore: [1] }),
    });
    await main(context as never);
    expect(responses[0].status).toBe(200);
    const updateCall = mockUpdateDocument.mock.calls[0];
    const patch = updateCall[3] as Record<string, unknown>;
    expect(patch['nextReminderAt']).toBe(existingBillingDate - 1 * 24 * 60 * 60 * 1000);
    expect(patch['reminderDaysBefore']).toBe('[1]');
  });
});

// ---------------------------------------------------------------------------
// deleteSubscription — soft delete
// ---------------------------------------------------------------------------

describe('deleteSubscription (DELETE /subscriptions/:id)', () => {
  it('returns 404 when subscription not found', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });
    const { context, responses } = makeContext({
      method: 'DELETE',
      path: '/subscriptions/sub-x',
      headers: withAuth(),
    });
    await main(context as never);
    expect(responses[0].status).toBe(404);
  });

  it('sets active=false and stamps deletedAt', async () => {
    mockListDocuments.mockResolvedValue({ documents: [sampleDoc] });
    const before = Date.now();
    const { context, responses } = makeContext({
      method: 'DELETE',
      path: '/subscriptions/sub-1',
      headers: withAuth(),
    });
    await main(context as never);
    expect(responses[0].status).toBe(200);
    expect((responses[0].data as { id: string }).id).toBe('sub-1');
    const updateCall = mockUpdateDocument.mock.calls[0];
    const patch = updateCall[3] as Record<string, unknown>;
    expect(patch['active']).toBe(false);
    expect(patch['deletedAt']).toBeGreaterThanOrEqual(before);
  });
});

// ---------------------------------------------------------------------------
// listDeletedSubscriptions — sorted by deletedAt DESC
// ---------------------------------------------------------------------------

describe('listDeletedSubscriptions (GET /subscriptions/deleted)', () => {
  it('returns empty array when no deleted subscriptions', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });
    const { context, responses } = makeContext({
      method: 'GET',
      path: '/subscriptions/deleted',
      headers: withAuth(),
      query: { userId: VALID_USER_ID },
    });
    await main(context as never);
    expect(responses[0].status).toBe(200);
    expect(responses[0].data).toEqual([]);
  });

  it('returns subscriptions sorted by deletedAt DESC (most recently deleted first)', async () => {
    const older = { ...sampleDoc, $id: 'sub-old', active: false, deletedAt: 1000, updatedAt: 1000 };
    const newer = { ...sampleDoc, $id: 'sub-new', active: false, deletedAt: 5000, updatedAt: 5000 };
    mockListDocuments.mockResolvedValue({ documents: [older, newer] });

    const { context, responses } = makeContext({
      method: 'GET',
      path: '/subscriptions/deleted',
      headers: withAuth(),
    });
    await main(context as never);
    expect(responses[0].status).toBe(200);
    const list = responses[0].data as Array<{ id: string }>;
    expect(list[0].id).toBe('sub-new');
    expect(list[1].id).toBe('sub-old');
  });
});

// ---------------------------------------------------------------------------
// restoreSubscription — sets active=true, clears deletedAt
// ---------------------------------------------------------------------------

describe('restoreSubscription (POST /subscriptions/:id/restore)', () => {
  it('returns 404 when subscription not found', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });
    const { context, responses } = makeContext({
      method: 'POST',
      path: '/subscriptions/sub-x/restore',
      headers: withAuth(),
    });
    await main(context as never);
    expect(responses[0].status).toBe(404);
  });

  it('sets active=true and clears deletedAt', async () => {
    const deletedDoc = { ...sampleDoc, active: false, deletedAt: 9999 };
    mockListDocuments.mockResolvedValue({ documents: [deletedDoc] });
    const { context, responses } = makeContext({
      method: 'POST',
      path: '/subscriptions/sub-1/restore',
      headers: withAuth(),
    });
    await main(context as never);
    expect(responses[0].status).toBe(200);
    const updateCall = mockUpdateDocument.mock.calls[0];
    const patch = updateCall[3] as Record<string, unknown>;
    expect(patch['active']).toBe(true);
    expect(patch['deletedAt']).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// permanentlyDeleteSubscription — rejects active docs
// ---------------------------------------------------------------------------

describe('permanentlyDeleteSubscription (POST /subscriptions/:id/permanent-delete)', () => {
  it('returns 404 when subscription not found', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });
    const { context, responses } = makeContext({
      method: 'POST',
      path: '/subscriptions/sub-x/permanent-delete',
      headers: withAuth(),
    });
    await main(context as never);
    expect(responses[0].status).toBe(404);
  });

  it('returns 400 when subscription is still active (deleted: false)', async () => {
    mockListDocuments.mockResolvedValue({ documents: [{ ...sampleDoc, active: true }] });
    const { context, responses } = makeContext({
      method: 'POST',
      path: '/subscriptions/sub-1/permanent-delete',
      headers: withAuth(),
    });
    await main(context as never);
    expect(responses[0].status).toBe(400);
    expect(mockDeleteDocument).not.toHaveBeenCalled();
  });

  it('permanently deletes when active=false', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [{ ...sampleDoc, active: false, deletedAt: 9999 }],
    });
    const { context, responses } = makeContext({
      method: 'POST',
      path: '/subscriptions/sub-1/permanent-delete',
      headers: withAuth(),
    });
    await main(context as never);
    expect(responses[0].status).toBe(200);
    expect(mockDeleteDocument).toHaveBeenCalledWith('ai-note-keeper', 'subscriptions', 'sub-1');
  });
});

// ---------------------------------------------------------------------------
// emptySubscriptionTrash — deletes all inactive docs for user
// ---------------------------------------------------------------------------

describe('emptySubscriptionTrash (DELETE /subscriptions/trash)', () => {
  it('returns { deleted: 0 } when trash is empty', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });
    const { context, responses } = makeContext({
      method: 'DELETE',
      path: '/subscriptions/trash',
      headers: withAuth(),
      query: { userId: VALID_USER_ID },
    });
    await main(context as never);
    expect(responses[0].status).toBe(200);
    expect((responses[0].data as { deleted: number }).deleted).toBe(0);
  });

  it('deletes all inactive subscriptions for user', async () => {
    const trashed = [
      { ...sampleDoc, $id: 'sub-a', active: false },
      { ...sampleDoc, $id: 'sub-b', active: false },
    ];
    mockListDocuments.mockResolvedValue({ documents: trashed });
    const { context, responses } = makeContext({
      method: 'DELETE',
      path: '/subscriptions/trash',
      headers: withAuth(),
      query: { userId: VALID_USER_ID },
    });
    await main(context as never);
    expect(responses[0].status).toBe(200);
    expect((responses[0].data as { deleted: number }).deleted).toBe(2);
    expect(mockDeleteDocument).toHaveBeenCalledTimes(2);
    expect(mockDeleteDocument).toHaveBeenCalledWith('ai-note-keeper', 'subscriptions', 'sub-a');
    expect(mockDeleteDocument).toHaveBeenCalledWith('ai-note-keeper', 'subscriptions', 'sub-b');
  });
});
