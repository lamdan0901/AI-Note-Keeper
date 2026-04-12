import { jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Shared Appwrite runtime context factory for contract/integration tests.
// Usage:
//   const { context, responses } = makeContext({ method: 'POST', path: '/parse', body: '...', headers: withAuth() });
//   await main(context as never);
//   const result = responses[0].data;
// ---------------------------------------------------------------------------

export function makeContext(overrides: {
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
      method: overrides.method ?? 'POST',
      path: overrides.path ?? '/',
      headers: overrides.headers ?? {},
      body: overrides.body ?? '{}',
      query: overrides.query ?? {},
    },
    res,
    log: jest.fn() as jest.Mock,
    error: jest.fn() as jest.Mock,
  };

  return { context, responses };
}

export function withAuth(
  userId = 'user-abc',
  extra: Record<string, string> = {},
): Record<string, string> {
  return { 'x-appwrite-user-id': userId, ...extra };
}
