import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import type { PushDeliveryRequest } from '../../jobs/push/contracts.js';
import {
  createFcmPushProvider,
  resetFcmProviderAuthCacheForTests,
} from '../../jobs/push/fcm-provider.js';

const createRequest = (): PushDeliveryRequest => {
  return {
    userId: 'user-1',
    reminderId: 'reminder-1',
    changeEventId: 'event-1',
    isTrigger: true,
    attempt: 0,
    token: {
      deviceId: 'device-1',
      fcmToken: 'fcm-token-1',
    },
  };
};

const createServiceAccountJson = (projectId: string): string => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });

  return JSON.stringify({
    project_id: projectId,
    client_email: `test-${Date.now()}@${projectId}.iam.gserviceaccount.com`,
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    token_uri: 'https://oauth2.googleapis.com/token',
  });
};

const getUrl = (input: unknown): string => {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  if (
    typeof input === 'object' &&
    input !== null &&
    'url' in input &&
    typeof (input as { url: unknown }).url === 'string'
  ) {
    return (input as { url: string }).url;
  }

  return String(input);
};

const createEnvRestorer = (): (() => void) => {
  const previousProjectId = process.env.FIREBASE_PROJECT_ID;
  const previousServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;

  return () => {
    if (previousProjectId === undefined) {
      delete process.env.FIREBASE_PROJECT_ID;
    } else {
      process.env.FIREBASE_PROJECT_ID = previousProjectId;
    }

    if (previousServiceAccount === undefined) {
      delete process.env.FIREBASE_SERVICE_ACCOUNT;
    } else {
      process.env.FIREBASE_SERVICE_ACCOUNT = previousServiceAccount;
    }
  };
};

test('FCM provider returns explicit configuration error when service account is missing', async () => {
  const restoreEnv = createEnvRestorer();
  resetFcmProviderAuthCacheForTests();

  process.env.FIREBASE_PROJECT_ID = 'test-project';
  delete process.env.FIREBASE_SERVICE_ACCOUNT;

  try {
    const provider = createFcmPushProvider();
    const response = await provider.sendToToken(createRequest());

    assert.equal(response.ok, false);
    if (response.ok) {
      return;
    }

    assert.equal(response.errorCode, 'FIREBASE_SERVICE_ACCOUNT_MISSING');
  } finally {
    restoreEnv();
  }
});

test('FCM provider classifies timed-out requests as transient timeout failures', async () => {
  const restoreEnv = createEnvRestorer();
  const previousFetch = globalThis.fetch;
  resetFcmProviderAuthCacheForTests();

  process.env.FIREBASE_PROJECT_ID = 'test-project';
  process.env.FIREBASE_SERVICE_ACCOUNT = createServiceAccountJson('test-project');

  globalThis.fetch = (async (input) => {
    const url = getUrl(input);
    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(
        JSON.stringify({
          access_token: 'access-token-1',
          expires_in: 3600,
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      );
    }

    const error = new Error('request timed out');
    error.name = 'TimeoutError';
    throw error;
  }) as typeof globalThis.fetch;

  try {
    const provider = createFcmPushProvider();
    const response = await provider.sendToToken(createRequest());

    assert.equal(response.ok, false);
    if (response.ok) {
      return;
    }

    assert.equal(response.statusCode, 504);
    assert.equal(response.errorCode, 'FCM_TIMEOUT');
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv();
  }
});

test('FCM provider classifies OAuth 503 failures as transient auth unavailability', async () => {
  const restoreEnv = createEnvRestorer();
  const previousFetch = globalThis.fetch;
  resetFcmProviderAuthCacheForTests();

  process.env.FIREBASE_PROJECT_ID = 'test-project';
  process.env.FIREBASE_SERVICE_ACCOUNT = createServiceAccountJson('test-project');

  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        error: 'server_error',
        error_description: 'backend unavailable',
      }),
      {
        status: 503,
        headers: {
          'content-type': 'application/json',
        },
      },
    );
  }) as typeof globalThis.fetch;

  try {
    const provider = createFcmPushProvider();
    const response = await provider.sendToToken(createRequest());

    assert.equal(response.ok, false);
    if (response.ok) {
      return;
    }

    assert.equal(response.statusCode, 503);
    assert.equal(response.errorCode, 'FCM_AUTH_UNAVAILABLE');
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv();
  }
});

test('FCM provider preserves OAuth 429 as transient retryable auth failure', async () => {
  const restoreEnv = createEnvRestorer();
  const previousFetch = globalThis.fetch;
  resetFcmProviderAuthCacheForTests();

  process.env.FIREBASE_PROJECT_ID = 'test-project';
  process.env.FIREBASE_SERVICE_ACCOUNT = createServiceAccountJson('test-project');

  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        error: 'rate_limited',
        error_description: 'too many requests',
      }),
      {
        status: 429,
        headers: {
          'content-type': 'application/json',
        },
      },
    );
  }) as typeof globalThis.fetch;

  try {
    const provider = createFcmPushProvider();
    const response = await provider.sendToToken(createRequest());

    assert.equal(response.ok, false);
    if (response.ok) {
      return;
    }

    assert.equal(response.statusCode, 429);
    assert.equal(response.errorCode, 'FCM_AUTH_UNAVAILABLE');
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv();
  }
});

test('FCM provider keeps OAuth 400 invalid_grant as terminal auth failure with sanitized message', async () => {
  const restoreEnv = createEnvRestorer();
  const previousFetch = globalThis.fetch;
  resetFcmProviderAuthCacheForTests();

  process.env.FIREBASE_PROJECT_ID = 'test-project';
  process.env.FIREBASE_SERVICE_ACCOUNT = createServiceAccountJson('test-project');

  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        error: 'invalid_grant',
        error_description: 'invalid JWT signature',
      }),
      {
        status: 400,
        headers: {
          'content-type': 'application/json',
        },
      },
    );
  }) as typeof globalThis.fetch;

  try {
    const provider = createFcmPushProvider();
    const response = await provider.sendToToken(createRequest());

    assert.equal(response.ok, false);
    if (response.ok) {
      return;
    }

    assert.equal(response.statusCode, 400);
    assert.equal(response.errorCode, 'FCM_AUTH_FAILED');
    assert.equal(response.message, 'invalid_grant: invalid JWT signature');
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv();
  }
});

test('FCM provider maps HTTP v1 UNREGISTERED to cleanup signal', async () => {
  const restoreEnv = createEnvRestorer();
  const previousFetch = globalThis.fetch;
  resetFcmProviderAuthCacheForTests();

  process.env.FIREBASE_PROJECT_ID = 'test-project';
  process.env.FIREBASE_SERVICE_ACCOUNT = createServiceAccountJson('test-project');

  globalThis.fetch = (async (input) => {
    const url = getUrl(input);
    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(
        JSON.stringify({
          access_token: 'access-token-1',
          expires_in: 3600,
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      );
    }

    return new Response(
      JSON.stringify({
        error: {
          code: 404,
          message: 'Requested entity was not found.',
          status: 'NOT_FOUND',
          details: [
            {
              '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
              errorCode: 'UNREGISTERED',
            },
          ],
        },
      }),
      {
        status: 404,
        headers: {
          'content-type': 'application/json',
        },
      },
    );
  }) as typeof globalThis.fetch;

  try {
    const provider = createFcmPushProvider();
    const response = await provider.sendToToken(createRequest());

    assert.equal(response.ok, false);
    if (response.ok) {
      return;
    }

    assert.equal(response.statusCode, 404);
    assert.equal(response.errorCode, 'UNREGISTERED');
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv();
  }
});

test('FCM provider serializes trigger payload with reminderId, noteId, and eventId fields', async () => {
  const restoreEnv = createEnvRestorer();
  const previousFetch = globalThis.fetch;
  resetFcmProviderAuthCacheForTests();

  process.env.FIREBASE_PROJECT_ID = 'test-project';
  process.env.FIREBASE_SERVICE_ACCOUNT = createServiceAccountJson('test-project');

  let sentBody: string | null = null;
  let sentAuthHeader: string | null = null;
  let sentUrl: string | null = null;
  globalThis.fetch = (async (input, init) => {
    const url = getUrl(input);
    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(
        JSON.stringify({
          access_token: 'access-token-1',
          expires_in: 3600,
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      );
    }

    sentUrl = url;
    sentBody = typeof init?.body === 'string' ? init.body : null;
    sentAuthHeader = new Headers(init?.headers).get('authorization');
    return new Response(JSON.stringify({ name: 'projects/test/messages/1' }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    });
  }) as typeof globalThis.fetch;

  try {
    const provider = createFcmPushProvider();
    const response = await provider.sendToToken(createRequest());

    assert.equal(response.ok, true);
    assert.ok(sentBody);
    assert.equal(sentUrl, 'https://fcm.googleapis.com/v1/projects/test-project/messages:send');
    assert.equal(sentAuthHeader, 'Bearer access-token-1');

    const payload = JSON.parse(sentBody ?? '{}') as {
      message?: {
        data?: {
          type?: string;
          reminderId?: string;
          noteId?: string;
          id?: string;
          eventId?: string;
        };
        android?: {
          priority?: string;
        };
      };
    };

    assert.equal(payload.message?.android?.priority, 'HIGH');
    assert.equal(payload.message?.data?.type, 'trigger_reminder');
    assert.equal(payload.message?.data?.reminderId, 'reminder-1');
    assert.equal(payload.message?.data?.noteId, 'reminder-1');
    assert.equal(payload.message?.data?.id, 'reminder-1');
    assert.equal(payload.message?.data?.eventId, 'event-1');
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv();
  }
});
