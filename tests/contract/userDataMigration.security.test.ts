import { test, expect, jest, describe, beforeEach, afterEach } from '@jest/globals';
import { makeContext } from '../helpers/makeContext';

const mockListDocuments = jest.fn() as any;
const mockCreateDocument = jest.fn() as any;
const mockUpdateDocument = jest.fn() as any;
const mockDeleteDocument = jest.fn() as any;
const mockDeleteSession = jest.fn() as any;

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
  Users: jest.fn().mockImplementation(() => ({
    deleteSession: mockDeleteSession,
  })),
  ID: { unique: () => 'gen-id' },
  Query: {
    equal: (field: string, value: unknown) => `${field}=${String(value)}`,
    limit: (n: number) => `limit:${n}`,
    cursorAfter: (id: string) => `cursorAfter:${id}`,
  },
}));

import main from '../../appwrite-functions/user-data-migration/src/main';

const FROM_USER = 'device-user-1';
const TO_USER = 'account-user-1';
const USERNAME = 'alice';
const PASSWORD = 'password123';
const ENDPOINT = 'https://cloud.appwrite.io/v1';

const WELCOME_NOTE = {
  $id: 'note-welcome',
  id: 'note-welcome',
  userId: FROM_USER,
  title: 'Welcome to AI Note Keeper',
  content: 'This is your first note. Edit or delete it anytime.',
  active: true,
  updatedAt: 1000,
  createdAt: 900,
};

let fetchSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.APPWRITE_FUNCTION_API_ENDPOINT = ENDPOINT;
  process.env.APPWRITE_FUNCTION_API_KEY = 'test-key';
  process.env.APPWRITE_FUNCTION_PROJECT_ID = 'test-project-id';

  fetchSpy = jest.spyOn(globalThis, 'fetch');
  mockDeleteSession.mockResolvedValue({});
  mockCreateDocument.mockImplementation((_db: string, _col: string, id: string, data: unknown) =>
    Promise.resolve({ $id: id, ...(data as object) }),
  );
  mockUpdateDocument.mockImplementation((_db: string, _col: string, id: string, data: unknown) =>
    Promise.resolve({ $id: id, ...(data as object) }),
  );
  mockDeleteDocument.mockResolvedValue({});

  // Default: no existing migration attempts, empty collections
  mockListDocuments.mockResolvedValue({ documents: [] });
});

afterEach(() => {
  fetchSpy.mockRestore();
});

function mockSuccessfulAuth() {
  fetchSpy.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ $id: 'session-123', userId: TO_USER }),
  } as Response);
}

function mockFailedAuth() {
  fetchSpy.mockResolvedValueOnce({
    ok: false,
    json: () => Promise.resolve({ message: 'Invalid credentials' }),
  } as Response);
}

describe('POST /preflight', () => {
  test('should return summary structure on success', async () => {
    mockSuccessfulAuth();

    const { context, responses } = makeContext({
      method: 'POST',
      path: '/preflight',
      body: JSON.stringify({
        fromUserId: FROM_USER,
        toUserId: TO_USER,
        username: USERNAME,
        password: PASSWORD,
      }),
    });

    await main(context);

    expect(responses[0].status).toBe(200);
    const summary = responses[0].data as Record<string, unknown>;
    expect(summary).toHaveProperty('sourceEmpty');
    expect(summary).toHaveProperty('targetEmpty');
    expect(summary).toHaveProperty('sourceSampleOnly');
    expect(summary).toHaveProperty('hasConflicts');
    expect(summary).toHaveProperty('sourceCounts');
    expect(summary).toHaveProperty('targetCounts');
  });

  test('should detect sample-only source snapshot', async () => {
    // Source has only the welcome note
    mockSuccessfulAuth();
    mockListDocuments
      // migrationAttempts (throttle check)
      .mockResolvedValueOnce({ documents: [] })
      // source: notes
      .mockResolvedValueOnce({ documents: [WELCOME_NOTE] })
      // source: subscriptions
      .mockResolvedValueOnce({ documents: [] })
      // source: devicePushTokens
      .mockResolvedValueOnce({ documents: [] })
      // source: noteChangeEvents
      .mockResolvedValueOnce({ documents: [] })
      // target: notes
      .mockResolvedValueOnce({ documents: [] })
      // target: subscriptions
      .mockResolvedValueOnce({ documents: [] })
      // target: devicePushTokens
      .mockResolvedValueOnce({ documents: [] })
      // target: noteChangeEvents
      .mockResolvedValueOnce({ documents: [] })
      // clearFailedAttempts
      .mockResolvedValueOnce({ documents: [] });

    const { context, responses } = makeContext({
      method: 'POST',
      path: '/preflight',
      body: JSON.stringify({
        fromUserId: FROM_USER,
        toUserId: TO_USER,
        username: USERNAME,
        password: PASSWORD,
      }),
    });

    await main(context);

    expect(responses[0].status).toBe(200);
    const summary = responses[0].data as Record<string, unknown>;
    expect(summary.sourceSampleOnly).toBe(true);
    expect(summary.sourceEmpty).toBe(false);
    expect(summary.targetEmpty).toBe(true);
  });

  test('should return 400 on invalid credentials', async () => {
    mockFailedAuth();

    const { context, responses } = makeContext({
      method: 'POST',
      path: '/preflight',
      body: JSON.stringify({
        fromUserId: FROM_USER,
        toUserId: TO_USER,
        username: USERNAME,
        password: 'wrong-password',
      }),
    });

    await main(context);

    expect(responses[0].status).toBe(401);
    expect((responses[0].data as { error: string }).error).toBe('Invalid credentials');
  });

  test('should record failed attempt on invalid credentials', async () => {
    mockFailedAuth();

    const { context } = makeContext({
      method: 'POST',
      path: '/preflight',
      body: JSON.stringify({
        fromUserId: FROM_USER,
        toUserId: TO_USER,
        username: USERNAME,
        password: 'wrong-password',
      }),
    });

    await main(context);

    // Should create or update migration attempt record
    const createOrUpdateCalled =
      mockCreateDocument.mock.calls.some(
        (args) => (args as unknown[])[1] === 'migrationAttempts',
      ) ||
      mockUpdateDocument.mock.calls.some((args) => (args as unknown[])[1] === 'migrationAttempts');
    expect(createOrUpdateCalled).toBe(true);
  });

  test('should return 429 when throttle limit exceeded', async () => {
    // Simulate an existing blocked attempt
    const blockedUntil = Date.now() + 60000;
    mockListDocuments.mockResolvedValueOnce({
      documents: [
        {
          $id: 'attempt-1',
          key: TO_USER,
          attempts: 5,
          lastAttemptAt: Date.now() - 1000,
          blockedUntil,
        },
      ],
    });

    const { context, responses } = makeContext({
      method: 'POST',
      path: '/preflight',
      body: JSON.stringify({
        fromUserId: FROM_USER,
        toUserId: TO_USER,
        username: USERNAME,
        password: PASSWORD,
      }),
    });

    await main(context);

    expect(responses[0].status).toBe(429);
  });

  test('should return 400 when required fields missing', async () => {
    const { context, responses } = makeContext({
      method: 'POST',
      path: '/preflight',
      body: JSON.stringify({ fromUserId: FROM_USER }),
    });

    await main(context);

    expect(responses[0].status).toBe(400);
  });
});

describe('POST /apply', () => {
  test('should apply cloud strategy successfully (no data movement)', async () => {
    mockSuccessfulAuth();

    const { context, responses } = makeContext({
      method: 'POST',
      path: '/apply',
      body: JSON.stringify({
        fromUserId: FROM_USER,
        toUserId: TO_USER,
        username: USERNAME,
        password: PASSWORD,
        strategy: 'cloud',
      }),
    });

    await main(context);

    expect(responses[0].status).toBe(200);
    const result = responses[0].data as Record<string, unknown>;
    expect(result.strategy).toBe('cloud');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('targetCounts');
  });

  test('should return 400 when strategy is invalid', async () => {
    const { context, responses } = makeContext({
      method: 'POST',
      path: '/apply',
      body: JSON.stringify({
        fromUserId: FROM_USER,
        toUserId: TO_USER,
        username: USERNAME,
        password: PASSWORD,
        strategy: 'invalid',
      }),
    });

    await main(context);

    expect(responses[0].status).toBe(400);
  });

  test('should return 400 when required fields missing', async () => {
    const { context, responses } = makeContext({
      method: 'POST',
      path: '/apply',
      body: JSON.stringify({ fromUserId: FROM_USER }),
    });

    await main(context);

    expect(responses[0].status).toBe(400);
  });
});
