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
    updateDocument: mockUpdateDocument,
  })),
  Functions: jest.fn().mockImplementation(() => ({
    createExecution: mockCreateExecution,
  })),
  Query: {
    equal: jest.fn((f, v) => `${f}=${v}`),
    lessThanEqual: jest.fn((f, v) => `${f}<=${v}`),
    isNotNull: jest.fn((f) => `isNotNull:${f}`),
    limit: jest.fn((n) => `limit=${n}`),
  },
}));

// ---------------------------------------------------------------------------
// Mocks — billing utilities
// ---------------------------------------------------------------------------

const mockComputeNextReminderAt = jest.fn();
const mockComputeAdvancedBillingDate = jest.fn();

jest.mock('./utils/billing.js', () => ({
  computeNextReminderAt: (...args: unknown[]) => mockComputeNextReminderAt(...args),
  computeAdvancedBillingDate: (...args: unknown[]) => mockComputeAdvancedBillingDate(...args),
}));

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const now = Date.now();

beforeEach(() => {
  jest.clearAllMocks();
  process.env.APPWRITE_FUNCTION_API_ENDPOINT = 'https://cloud.appwrite.io/v1';
  process.env.APPWRITE_FUNCTION_API_KEY = 'test-api-key';
  process.env.APPWRITE_FUNCTION_PROJECT_ID = 'test-project-id';
  process.env.PUSH_FUNCTION_ID = 'push-fn-id';

  mockListDocuments.mockResolvedValue({ documents: [] });
  mockUpdateDocument.mockResolvedValue({});
  mockCreateExecution.mockResolvedValue({ $id: 'exec-1' });

  // Default billing helpers
  mockComputeAdvancedBillingDate.mockReturnValue(now + 30 * 24 * 60 * 60 * 1000);
  mockComputeNextReminderAt.mockReturnValue(now + 27 * 24 * 60 * 60 * 1000);
});

function makeSubDoc(overrides: Record<string, unknown> = {}) {
  return {
    $id: 'sub-1',
    userId: 'user-1',
    serviceName: 'Netflix',
    currency: 'USD',
    price: 12.99,
    billingCycle: 'monthly',
    status: 'active',
    active: true,
    nextBillingDate: now - 60000, // 1 min overdue
    nextReminderAt: now - 60000,
    nextTrialReminderAt: null,
    trialEndDate: null,
    reminderDaysBefore: JSON.stringify([3, 7]),
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
// Billing reminders
// ---------------------------------------------------------------------------

describe('billing reminders', () => {
  it('returns billingNotified=0 when no due billing reminders', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    const { context, responses } = makeContext();
    await main(context as never);

    const data = responses[0].data as { billingNotified: number };
    expect(data.billingNotified).toBe(0);
    expect(mockCreateExecution).not.toHaveBeenCalled();
  });

  it('fires push and advances billing date for due billing reminder', async () => {
    const sub = makeSubDoc();
    const advancedDate = now + 30 * 24 * 60 * 60 * 1000;
    const nextReminder = now + 27 * 24 * 60 * 60 * 1000;

    mockComputeAdvancedBillingDate.mockReturnValue(advancedDate);
    mockComputeNextReminderAt.mockReturnValue(nextReminder);

    mockListDocuments
      .mockResolvedValueOnce({ documents: [sub] }) // billing due
      .mockResolvedValueOnce({ documents: [] }) // trial due (empty)
      .mockResolvedValueOnce({ documents: [] }); // overdue billing (empty)

    const { context, responses } = makeContext();
    await main(context as never);

    const data = responses[0].data as { billingNotified: number };
    expect(data.billingNotified).toBe(1);

    // Push was fired with type=subscription and reminderKind=billing
    expect(mockCreateExecution).toHaveBeenCalledWith(
      'push-fn-id',
      expect.stringContaining('"reminderKind":"billing"'),
      true,
    );

    // Document updated with advanced billing date
    const updateArgs = mockUpdateDocument.mock.calls[0][3] as Record<string, unknown>;
    expect(updateArgs.nextBillingDate).toBe(advancedDate);
    expect(updateArgs.nextReminderAt).toBe(nextReminder);
    expect(updateArgs.lastNotifiedBillingDate).toBe(sub.nextBillingDate);
  });

  it('sends push payload with service name in title', async () => {
    const sub = makeSubDoc({ serviceName: 'Spotify', price: 9.99, currency: '$' });

    mockListDocuments
      .mockResolvedValueOnce({ documents: [sub] })
      .mockResolvedValueOnce({ documents: [] })
      .mockResolvedValueOnce({ documents: [] });

    const { context } = makeContext();
    await main(context as never);

    const execBody = JSON.parse(mockCreateExecution.mock.calls[0][1] as string) as {
      title: string;
      userId: string;
      subscriptionId: string;
    };
    expect(execBody.title).toContain('Spotify');
    expect(execBody.userId).toBe('user-1');
    expect(execBody.subscriptionId).toBe('sub-1');
  });
});

// ---------------------------------------------------------------------------
// Trial reminders
// ---------------------------------------------------------------------------

describe('trial reminders', () => {
  it('fires push and updates nextTrialReminderAt for due trial reminder', async () => {
    const trialEndDate = now + 3 * 24 * 60 * 60 * 1000;
    const sub = makeSubDoc({
      nextTrialReminderAt: now - 60000,
      trialEndDate,
      nextReminderAt: null,
    });
    const nextTrialReminder = now + 2 * 24 * 60 * 60 * 1000;
    mockComputeNextReminderAt.mockReturnValue(nextTrialReminder);

    mockListDocuments
      .mockResolvedValueOnce({ documents: [] }) // billing due (empty)
      .mockResolvedValueOnce({ documents: [sub] }) // trial due
      .mockResolvedValueOnce({ documents: [] }); // overdue billing

    const { context, responses } = makeContext();
    await main(context as never);

    const data = responses[0].data as { trialNotified: number };
    expect(data.trialNotified).toBe(1);

    // Push was fired with reminderKind=trial_end
    expect(mockCreateExecution).toHaveBeenCalledWith(
      'push-fn-id',
      expect.stringContaining('"reminderKind":"trial_end"'),
      true,
    );

    // Updated with new trial reminder date
    const updateArgs = mockUpdateDocument.mock.calls[0][3] as Record<string, unknown>;
    expect(updateArgs.nextTrialReminderAt).toBe(nextTrialReminder);
    expect(updateArgs.lastNotifiedTrialEndDate).toBe(trialEndDate);
  });
});

// ---------------------------------------------------------------------------
// Auto-advance overdue billing
// ---------------------------------------------------------------------------

describe('auto-advance overdue billing', () => {
  it('advances overdue billing dates without pushing', async () => {
    const sub = makeSubDoc({
      nextBillingDate: now - 3 * 24 * 60 * 60 * 1000, // 3 days overdue
      nextReminderAt: null,
    });
    // Make computeAdvancedBillingDate return a future date on first call
    mockComputeAdvancedBillingDate.mockReturnValue(now + 30 * 24 * 60 * 60 * 1000);
    mockComputeNextReminderAt.mockReturnValue(null);

    mockListDocuments
      .mockResolvedValueOnce({ documents: [] }) // billing reminders (empty — nextReminderAt already null)
      .mockResolvedValueOnce({ documents: [] }) // trial reminders (empty)
      .mockResolvedValueOnce({ documents: [sub] }); // overdue billing

    const { context, responses } = makeContext();
    await main(context as never);

    const data = responses[0].data as { billingAdvanced: number };
    expect(data.billingAdvanced).toBe(1);

    // No push for auto-advance
    // (createExecution may have been called for billing reminder above, but not for advance)
    // In this scenario billing notifications step found 0, so no push at all
    const execCalls = mockCreateExecution.mock.calls.filter((call) => {
      const body = JSON.parse(call[1] as string) as { type: string };
      return body.type === 'subscription';
    });
    expect(execCalls).toHaveLength(0);

    const updateArgs = mockUpdateDocument.mock.calls[0][3] as Record<string, unknown>;
    expect(typeof updateArgs.nextBillingDate).toBe('number');
    expect(updateArgs.nextBillingDate as number).toBeGreaterThan(Date.now());
  });
});
