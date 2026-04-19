import assert from 'node:assert/strict';
import type { Server } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createTokenFactory } from '../../auth/tokens.js';
import { createAiRateLimiter } from '../../ai/rate-limit.js';
import { createAiRoutes } from '../../ai/routes.js';
import type { AiService } from '../../ai/service.js';
import { errorMiddleware, notFoundMiddleware } from '../../middleware/error-middleware.js';

const createServiceDouble = (): AiService => {
  return {
    parseVoiceNoteIntent: async (request) => ({
      draft: {
        title: request.transcript.length > 0 ? 'Parsed title' : null,
        content: null,
        reminderAtEpochMs: 1_700_074_800_000,
        repeat: { kind: 'daily', interval: 1 },
        keepTranscriptInContent: true,
        normalizedTranscript: request.transcript.trim(),
      },
      confidence: {
        title: 0.8,
        content: 0.4,
        reminder: 0.7,
        repeat: 0.6,
      },
      clarification: {
        required: false,
        question: null,
        missingFields: [],
      },
    }),
    continueVoiceClarification: async (request) => ({
      draft: {
        ...request.priorDraft,
        title: request.priorDraft.title ?? 'Clarified title',
      },
      confidence: {
        title: 1,
        content: 1,
        reminder: 1,
        repeat: 1,
      },
      clarification: {
        required: false,
        question: null,
        missingFields: [],
      },
    }),
  };
};

const startServer = async (
  service: AiService,
  parseLimit: number,
): Promise<Readonly<{ baseUrl: string; close: () => Promise<void> }>> => {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/ai',
    createAiRoutes(
      service,
      createAiRateLimiter(
        {
          parseLimit,
          clarifyLimit: 10,
          windowMs: 60_000,
        },
        () => 1_700_000_000_000,
      ),
    ),
  );
  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  const server = await new Promise<Server>((resolve, reject) => {
    const running = app.listen(0, '127.0.0.1', () => resolve(running));
    running.once('error', reject);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP address');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
};

const createAccessToken = async (userId: string): Promise<string> => {
  const tokenFactory = createTokenFactory();
  const pair = await tokenFactory.issueTokenPair({
    userId,
    username: userId,
  });

  return pair.accessToken;
};

const parseRequestBody = {
  transcript: 'remind me to call mom tomorrow at 7 pm every day',
  userId: 'user-1',
  timezone: 'UTC',
  nowEpochMs: 1_700_000_000_000,
  locale: 'en-US',
  sessionId: 'session-1',
};

test('AI routes validate payloads and return stable validation contract', async () => {
  const server = await startServer(createServiceDouble(), 10);
  const token = await createAccessToken('user-1');

  try {
    const parseInvalid = await fetch(`${server.baseUrl}/api/ai/parse-voice`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ transcript: '' }),
    });

    assert.equal(parseInvalid.status, 400);
    const parsePayload = (await parseInvalid.json()) as { code: string; status: number };
    assert.equal(parsePayload.code, 'validation');
    assert.equal(parsePayload.status, 400);

    const clarifyInvalid = await fetch(`${server.baseUrl}/api/ai/clarify`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ clarificationAnswer: '' }),
    });

    assert.equal(clarifyInvalid.status, 400);
    const clarifyPayload = (await clarifyInvalid.json()) as { code: string; status: number };
    assert.equal(clarifyPayload.code, 'validation');
    assert.equal(clarifyPayload.status, 400);
  } finally {
    await server.close();
  }
});

test('AI parse endpoint enforces per-user rate limit contract', async () => {
  const server = await startServer(createServiceDouble(), 1);
  const token = await createAccessToken('user-1');

  try {
    const first = await fetch(`${server.baseUrl}/api/ai/parse-voice`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(parseRequestBody),
    });

    assert.equal(first.status, 200);

    const second = await fetch(`${server.baseUrl}/api/ai/parse-voice`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(parseRequestBody),
    });

    assert.equal(second.status, 429);
    const payload = (await second.json()) as {
      code: string;
      status: number;
      details?: { retryAfterSeconds?: number; resetAt?: number };
    };

    assert.equal(payload.code, 'rate_limit');
    assert.equal(payload.status, 429);
    assert.ok((payload.details?.retryAfterSeconds ?? 0) >= 1);
  } finally {
    await server.close();
  }
});

test('AI parse and clarify routes return normalized DTO payloads for valid requests', async () => {
  const server = await startServer(createServiceDouble(), 10);
  const token = await createAccessToken('user-1');

  try {
    const parseResponse = await fetch(`${server.baseUrl}/api/ai/parse-voice`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(parseRequestBody),
    });

    assert.equal(parseResponse.status, 200);
    const parsePayload = (await parseResponse.json()) as {
      draft: { normalizedTranscript: string; reminderAtEpochMs: number | null };
      confidence: { title: number };
      clarification: { required: boolean };
    };

    assert.equal(parsePayload.draft.normalizedTranscript, parseRequestBody.transcript);
    assert.equal(parsePayload.draft.reminderAtEpochMs, 1_700_074_800_000);
    assert.equal(typeof parsePayload.confidence.title, 'number');
    assert.equal(typeof parsePayload.clarification.required, 'boolean');

    const clarifyResponse = await fetch(`${server.baseUrl}/api/ai/clarify`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: 'session-1',
        priorDraft: parsePayload.draft,
        clarificationAnswer: 'Yes, repeat daily',
        timezone: 'UTC',
        nowEpochMs: 1_700_000_000_000,
      }),
    });

    assert.equal(clarifyResponse.status, 200);
    const clarifyPayload = (await clarifyResponse.json()) as {
      draft: { normalizedTranscript: string };
      clarification: { required: boolean };
    };

    assert.equal(clarifyPayload.draft.normalizedTranscript, parseRequestBody.transcript);
    assert.equal(clarifyPayload.clarification.required, false);
  } finally {
    await server.close();
  }
});
