import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

import { AppError, errorMiddleware, notFoundMiddleware } from '../middleware/error-middleware.js';

type ServerHandle = {
  baseUrl: string;
  close: () => Promise<void>;
};

const startServer = async (): Promise<ServerHandle> => {
  const app = express();

  app.use(express.json());

  app.get('/known-conflict', (_req, _res, next) => {
    next(
      new AppError({ code: 'conflict', message: 'Duplicate payload', details: { field: 'id' } }),
    );
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

test('unknown errors include trimmed trace id from request header', async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.baseUrl}/unknown-failure`, {
      headers: { 'x-request-id': '  req-123  ' },
    });
    const payload = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 500);
    assert.equal(payload.traceId, 'req-123');
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
