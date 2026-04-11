import main from './main.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(bodyObj: Record<string, unknown> = {}) {
  const responses: Array<{ data: unknown; status: number }> = [];
  const context = {
    req: {
      method: 'POST',
      path: '/',
      headers: {},
      body: JSON.stringify(bodyObj),
      query: {},
    },
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
const mockCreateExecution = jest.fn();

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
  Functions: jest.fn().mockImplementation(() => ({
    createExecution: mockCreateExecution,
  })),
  Query: {
    equal: jest.fn((f, v) => `${f}=${v}`),
    limit: jest.fn((n) => `limit=${n}`),
  },
}));

// ---------------------------------------------------------------------------
// Mocks — crypto (createSign)
// ---------------------------------------------------------------------------

jest.mock('crypto', () => ({
  createSign: jest.fn().mockReturnValue({
    update: jest.fn(),
    end: jest.fn(),
    sign: jest.fn().mockReturnValue('mock-sig'),
  }),
}));

// ---------------------------------------------------------------------------
// Mocks — fetch (OAuth token exchange + FCM)
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();
global.fetch = mockFetch as typeof fetch;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  project_id: 'test-project',
  private_key: '-----BEGIN RSA PRIVATE KEY-----\nMOCK\n-----END RSA PRIVATE KEY-----',
  client_email: 'svc@test.iam.gserviceaccount.com',
});

const FIREBASE_PROJECT_ID = 'test-project';

const TOKEN_RESPONSE = {
  ok: true,
  json: jest.fn().mockResolvedValue({ access_token: 'mock-access-token' }),
  text: jest.fn().mockResolvedValue('{"access_token":"mock-access-token"}'),
};

const FCM_SUCCESS_RESPONSE = {
  ok: true,
  text: jest.fn().mockResolvedValue('{"name":"projects/test-project/messages/abc"}'),
};

/** Returns a URL-dispatching fetch mock. Override `fcmResponse` to control FCM results. */
function setupFetch(fcmResponse: unknown = FCM_SUCCESS_RESPONSE) {
  mockFetch.mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.includes('oauth2.googleapis.com')) return TOKEN_RESPONSE;
    return fcmResponse;
  });
}

function deviceDoc(overrides: Record<string, unknown> = {}) {
  return {
    $id: 'token-doc-1',
    deviceId: 'device-1',
    fcmToken: 'fcm-token-1',
    userId: 'user-1',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.APPWRITE_FUNCTION_API_ENDPOINT = 'https://cloud.appwrite.io/v1';
  process.env.APPWRITE_FUNCTION_API_KEY = 'test-api-key';
  process.env.APPWRITE_FUNCTION_PROJECT_ID = 'test-project-id';
  process.env.PUSH_FUNCTION_ID = 'push-fn-id';
  process.env.FIREBASE_SERVICE_ACCOUNT = FIREBASE_SERVICE_ACCOUNT;
  process.env.FIREBASE_PROJECT_ID = FIREBASE_PROJECT_ID;

  mockListDocuments.mockResolvedValue({ documents: [] });
  mockDeleteDocument.mockResolvedValue({});
  mockCreateExecution.mockResolvedValue({ $id: 'exec-1' });

  // Default: token exchange succeeds, FCM succeeds
  setupFetch();
});

// ---------------------------------------------------------------------------
// Env validation
// ---------------------------------------------------------------------------

describe('env validation', () => {
  it('returns 500 when APPWRITE_FUNCTION_API_ENDPOINT is missing', async () => {
    delete process.env.APPWRITE_FUNCTION_API_ENDPOINT;
    const { context, responses } = makeContext({ type: 'reminder' });
    await main(context as never);
    expect(responses[0].status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

describe('dispatch', () => {
  it('returns 400 for unknown type', async () => {
    const { context, responses } = makeContext({ type: 'unknown' });
    await main(context as never);
    expect(responses[0].status).toBe(400);
  });

  it('returns 400 for missing type', async () => {
    const { context, responses } = makeContext({});
    await main(context as never);
    expect(responses[0].status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Reminder push
// ---------------------------------------------------------------------------

describe('handleReminderPush', () => {
  const BASE_BODY = {
    type: 'reminder',
    userId: 'user-1',
    reminderId: 'reminder-1',
    changeEventId: 'event-1',
    isTrigger: false,
  };

  it('returns ok=true when push succeeds', async () => {
    mockListDocuments
      .mockResolvedValueOnce({ documents: [deviceDoc()] }) // device tokens
      .mockResolvedValueOnce({
        documents: [{ $id: 'reminder-1', title: 'Buy milk', content: '' }],
      }); // note

    const { context, responses } = makeContext(BASE_BODY);
    await main(context as never);

    expect(responses[0].status).toBe(200);
    expect((responses[0].data as { ok: boolean }).ok).toBe(true);
  });

  it('sends data-only FCM message (no notification block)', async () => {
    mockListDocuments
      .mockResolvedValueOnce({ documents: [deviceDoc()] })
      .mockResolvedValueOnce({
        documents: [{ $id: 'reminder-1', title: 'Buy milk', content: 'details' }],
      });

    const { context } = makeContext(BASE_BODY);
    await main(context as never);

    // Find the FCM send call (URL contains fcm.googleapis.com)
    const fcmCall = mockFetch.mock.calls.find(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('fcm.googleapis.com'),
    );
    expect(fcmCall).toBeDefined();
    const fcmBody = JSON.parse(fcmCall![1]?.body as string) as Record<string, unknown>;
    const message = fcmBody.message as Record<string, unknown>;

    // Must have 'data' field
    expect(message.data).toBeDefined();
    // Must NOT have top-level 'notification' field
    expect(message.notification).toBeUndefined();
    // data fields
    const data = message.data as Record<string, string>;
    expect(data.type).toBe('sync_reminder');
    expect(data.id).toBe('reminder-1');
    expect(data.eventId).toBe('event-1');
    expect(data.title).toBe('Buy milk');
  });

  it('uses trigger_reminder type when isTrigger=true', async () => {
    mockListDocuments
      .mockResolvedValueOnce({ documents: [deviceDoc()] })
      .mockResolvedValueOnce({ documents: [{ $id: 'reminder-1', title: 'X', content: '' }] });

    const { context } = makeContext({ ...BASE_BODY, isTrigger: true });
    await main(context as never);

    const fcmCall = mockFetch.mock.calls.find(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('fcm.googleapis.com'),
    );
    const fcmBody = JSON.parse(fcmCall![1]?.body as string) as Record<string, unknown>;
    const data = (fcmBody.message as Record<string, unknown>).data as Record<string, string>;
    expect(data.type).toBe('trigger_reminder');
  });

  it('filters out excludeDeviceId from targets', async () => {
    mockListDocuments
      .mockResolvedValueOnce({
        documents: [
          deviceDoc({ deviceId: 'device-1', fcmToken: 'tok-1' }),
          deviceDoc({ $id: 'tok-doc-2', deviceId: 'device-2', fcmToken: 'tok-2' }),
        ],
      })
      .mockResolvedValueOnce({ documents: [{ $id: 'reminder-1', title: 'X', content: '' }] });

    const { context } = makeContext({ ...BASE_BODY, excludeDeviceId: 'device-1' });
    await main(context as never);

    // Only one FCM call (only device-2 targeted)
    const fcmCalls = mockFetch.mock.calls.filter(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('fcm.googleapis.com'),
    );
    expect(fcmCalls).toHaveLength(1);
    const body = JSON.parse(fcmCalls[0][1]?.body as string) as { message: { token: string } };
    expect(body.message.token).toBe('tok-2');
  });

  it('deletes unregistered token on FCM 404 UNREGISTERED', async () => {
    mockListDocuments
      .mockResolvedValueOnce({ documents: [deviceDoc()] })
      .mockResolvedValueOnce({ documents: [{ $id: 'reminder-1', title: 'X', content: '' }] });

    setupFetch({
      ok: false,
      status: 404,
      text: jest
        .fn()
        .mockResolvedValue(JSON.stringify({ error: { details: [{ errorCode: 'UNREGISTERED' }] } })),
    });

    const { context } = makeContext(BASE_BODY);
    await main(context as never);

    expect(mockDeleteDocument).toHaveBeenCalledWith(
      'ai-note-keeper',
      'devicePushTokens',
      'token-doc-1',
    );
  });

  it('queues retry execution on 429 when retryCount < MAX_PUSH_RETRIES', async () => {
    mockListDocuments
      .mockResolvedValueOnce({ documents: [deviceDoc()] })
      .mockResolvedValueOnce({ documents: [{ $id: 'reminder-1', title: 'X', content: '' }] });

    setupFetch({
      ok: false,
      status: 429,
      text: jest.fn().mockResolvedValue('Too Many Requests'),
    });

    const { context } = makeContext({ ...BASE_BODY, retryCount: 0 });
    await main(context as never);

    expect(mockCreateExecution).toHaveBeenCalledWith(
      'push-fn-id',
      expect.stringContaining('"retryCount":1'),
      true,
    );
  });

  it('does NOT retry when retryCount has reached MAX_PUSH_RETRIES', async () => {
    mockListDocuments
      .mockResolvedValueOnce({ documents: [deviceDoc()] })
      .mockResolvedValueOnce({ documents: [{ $id: 'reminder-1', title: 'X', content: '' }] });

    setupFetch({
      ok: false,
      status: 429,
      text: jest.fn().mockResolvedValue('Too Many Requests'),
    });

    const { context } = makeContext({ ...BASE_BODY, retryCount: 2 }); // 2 == MAX_PUSH_RETRIES
    await main(context as never);

    expect(mockCreateExecution).not.toHaveBeenCalled();
  });

  it('returns ok=true and does not push when no tokens found', async () => {
    mockListDocuments.mockResolvedValueOnce({ documents: [] }); // no tokens

    const { context, responses } = makeContext(BASE_BODY);
    await main(context as never);

    expect(responses[0].status).toBe(200);
    // fetch should only have been called once (token exchange is skipped — no targets)
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns ok=true and does not push when FIREBASE env vars are missing', async () => {
    delete process.env.FIREBASE_SERVICE_ACCOUNT;

    mockListDocuments.mockResolvedValueOnce({ documents: [deviceDoc()] });

    const { context, responses } = makeContext(BASE_BODY);
    await main(context as never);

    expect(responses[0].status).toBe(200);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Subscription push
// ---------------------------------------------------------------------------

describe('handleSubscriptionPush', () => {
  const BASE_SUB_BODY = {
    type: 'subscription',
    userId: 'user-1',
    subscriptionId: 'sub-1',
    title: 'Netflix billing in 3 days',
    body: 'USD12.99 – monthly',
    reminderKind: 'billing',
  };

  it('sends FCM with subscription_reminder type payload', async () => {
    mockListDocuments.mockResolvedValueOnce({ documents: [deviceDoc()] });

    const { context, responses } = makeContext(BASE_SUB_BODY);
    await main(context as never);

    expect(responses[0].status).toBe(200);
    const fcmCall = mockFetch.mock.calls.find(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('fcm.googleapis.com'),
    );
    expect(fcmCall).toBeDefined();
    const fcmBody = JSON.parse(fcmCall![1]?.body as string) as Record<string, unknown>;
    const data = (fcmBody.message as Record<string, unknown>).data as Record<string, string>;
    expect(data.type).toBe('subscription_reminder');
    expect(data.reminderKind).toBe('billing');
    expect(data.id).toBe('sub-1');
    expect(data.title).toBe('Netflix billing in 3 days');
  });

  it('removes unregistered token on 404 UNREGISTERED for subscription push', async () => {
    mockListDocuments.mockResolvedValueOnce({ documents: [deviceDoc()] });

    setupFetch({
      ok: false,
      status: 404,
      text: jest
        .fn()
        .mockResolvedValue(JSON.stringify({ error: { details: [{ errorCode: 'UNREGISTERED' }] } })),
    });

    const { context } = makeContext(BASE_SUB_BODY);
    await main(context as never);

    expect(mockDeleteDocument).toHaveBeenCalledWith(
      'ai-note-keeper',
      'devicePushTokens',
      'token-doc-1',
    );
  });

  it('does NOT retry on 429 for subscription push', async () => {
    mockListDocuments.mockResolvedValueOnce({ documents: [deviceDoc()] });

    setupFetch({
      ok: false,
      status: 429,
      text: jest.fn().mockResolvedValue('Too Many Requests'),
    });

    const { context } = makeContext(BASE_SUB_BODY);
    await main(context as never);

    // No retry for subscription push
    expect(mockCreateExecution).not.toHaveBeenCalled();
  });
});
