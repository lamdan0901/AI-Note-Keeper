import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';
import { z } from 'zod';

import { AppError, errorMiddleware, notFoundMiddleware } from '../middleware/error-middleware.js';
import { validateRequest, withErrorBoundary } from '../middleware/validate.js';

type ServerHandle = {
  baseUrl: string;
  close: () => Promise<void>;
};

const startServer = async (): Promise<ServerHandle> => {
  const app = express();

  app.use(express.json());

  app.post(
    '/validated',
    validateRequest({
      body: z.object({
        amount: z.number().positive(),
      }),
    }),
    withErrorBoundary((req, res) => {
      res.status(200).json({ accepted: true, amount: req.body.amount });
    }),
  );

  app.get('/known-conflict', (_req, _res, next) => {
    next(
      new AppError({ code: 'conflict', message: 'Duplicate payload', details: { field: 'id' } }),
    );
  });

  app.get('/known-rate-limit', (_req, _res, next) => {
    next(
      new AppError({
        code: 'rate_limit',
        details: {
          retryAfterSeconds: 30,
          resetAt: '2026-04-18T00:00:00Z',
          stackHint: 'do-not-expose',
        },
      }),
    );
  });

  app.get('/known-no-trace', (_req, _res, next) => {
    next(new AppError({ code: 'forbidden' }));
  });

  app.get('/unknown-failure', () => {
    throw new Error('boom');
  });

  app.get('/known-with-trace', (_req, _res, next) => {
    next(new AppError({ code: 'forbidden', traceId: 'app-trace' }));
  });

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return await new Promise<ServerHandle>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to create test server'));
        return;
      }

      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((err) => {
              if (err) {
                fail(err);
                return;
              }

              done();
            });
          }),
      });
    });
  });
};

test('known app error returns mapped status and flat error shape', async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.baseUrl}/known-conflict`);
    const payload = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 409);
    assert.deepStrictEqual(payload, {
      code: 'conflict',
      message: 'Duplicate payload',
      status: 409,
      details: { field: 'id' },
    });
  } finally {
    await server.close();
  }
});

test('validation failures return validation code with safe details', async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.baseUrl}/validated`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount: -5, stack: 'leak' }),
    });
    const payload = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 400);
    assert.equal(payload.code, 'validation');
    assert.equal(typeof payload.message, 'string');
    assert.equal(payload.status, 400);
    assert.ok('details' in payload);

    const details = payload.details as { issues?: Array<{ path: string; message: string; code: string }> };
    assert.ok(Array.isArray(details.issues));
    assert.equal(details.issues?.[0]?.path, 'amount');
    assert.equal('stack' in details, false);
  } finally {
    await server.close();
  }
});

test('rate-limit errors include retry metadata only when present', async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.baseUrl}/known-rate-limit`);
    const payload = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 429);
    assert.deepStrictEqual(payload, {
      code: 'rate_limit',
      message: 'Rate limit exceeded',
      status: 429,
      details: {
        retryAfterSeconds: 30,
        resetAt: '2026-04-18T00:00:00Z',
      },
    });
  } finally {
    await server.close();
  }
});

test('unknown errors are normalized to internal category', async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.baseUrl}/unknown-failure`);
    const payload = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 500);
    assert.deepStrictEqual(payload, {
      code: 'internal',
      message: 'Internal server error',
      status: 500,
    });
  } finally {
    await server.close();
  }
});

test('missing route returns standardized not_found shape', async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.baseUrl}/missing`);
    const payload = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 404);
    assert.deepStrictEqual(payload, {
      code: 'not_found',
      message: 'Not found',
      status: 404,
    });
  } finally {
    await server.close();
  }
});

test('traceId is echoed only when provided', async () => {
  const server = await startServer();

  try {
    const responseWithHeader = await fetch(`${server.baseUrl}/unknown-failure`, {
      headers: { 'x-request-id': '  req-123  ' },
    });
    const payloadWithHeader = (await responseWithHeader.json()) as Record<string, unknown>;

    assert.equal(responseWithHeader.status, 500);
    assert.equal(payloadWithHeader.traceId, 'req-123');

    const responseWithoutHeader = await fetch(`${server.baseUrl}/known-no-trace`);
    const payloadWithoutHeader = (await responseWithoutHeader.json()) as Record<string, unknown>;

    assert.equal(responseWithoutHeader.status, 403);
    assert.equal('traceId' in payloadWithoutHeader, false);
  } finally {
    await server.close();
  }
});

test('app error trace id takes precedence over request header', async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.baseUrl}/known-with-trace`, {
      headers: { 'x-request-id': 'header-trace' },
    });
    const payload = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 403);
    assert.equal(payload.traceId, 'app-trace');
  } finally {
    await server.close();
  }
});