import assert from 'node:assert/strict';
import type { Server } from 'node:net';
import test from 'node:test';

import express from 'express';
import type { RequestHandler } from 'express';

import { createTokenFactory } from '../../auth/tokens.js';
import { errorMiddleware, notFoundMiddleware } from '../../middleware/error-middleware.js';
import {
  DEFAULT_EXPENSE_SCHEMA,
  type ExpensePeriodRecord,
  type ExpenseRowRecord,
  type ExpenseUserSettingsRecord,
} from '../../expenses/contracts.js';
import { createExpensesRoutes } from '../../expenses/routes.js';
import type { ExpensesRepository } from '../../expenses/repository.js';
import { createExpensesService } from '../../expenses/service.js';

const now = new Date('2026-06-06T12:00:00.000Z');

const createInMemoryExpensesRepository = (
  initial: Readonly<{
    settings?: ExpenseUserSettingsRecord | null;
    periods?: ReadonlyArray<ExpensePeriodRecord>;
    rows?: ReadonlyArray<ExpenseRowRecord>;
  }> = {},
): ExpensesRepository => {
  let settings = initial.settings ?? null;
  const periods = new Map<string, ExpensePeriodRecord>(
    (initial.periods ?? []).map((period) => [period.id, period]),
  );
  const rows = new Map<string, ExpenseRowRecord>(
    (initial.rows ?? []).map((row) => [row.id, row]),
  );

  const periodKey = (userId: string, year: number, month: number): string => {
    return `${userId}:${year}:${month}`;
  };

  const periodByMonth = new Map<string, string>();
  for (const period of periods.values()) {
    periodByMonth.set(periodKey(period.userId, period.year, period.month), period.id);
  }

  return {
    findSettingsByUser: async (userId) => {
      if (!settings || settings.userId !== userId) {
        return null;
      }

      return settings;
    },

    upsertSettings: async (input) => {
      settings = {
        userId: input.userId,
        defaultSchema: input.defaultSchema,
        seedRows: [...input.seedRows],
        updatedAt: now,
      };

      return settings;
    },

    listPeriodSummariesByUser: async (userId) => {
      return [...periods.values()]
        .filter((period) => period.userId === userId)
        .sort((left, right) => {
          if (left.year !== right.year) {
            return right.year - left.year;
          }

          return right.month - left.month;
        })
        .map((period) => ({
          id: period.id,
          userId: period.userId,
          year: period.year,
          month: period.month,
          label: `${period.year}-${period.month}`,
          createdAt: period.createdAt,
          updatedAt: period.updatedAt,
        }));
    },

    findPeriodByUserAndMonth: async ({ userId, year, month }) => {
      const periodId = periodByMonth.get(periodKey(userId, year, month));
      if (!periodId) {
        return null;
      }

      return periods.get(periodId) ?? null;
    },

    findPeriodByIdForUser: async ({ periodId, userId }) => {
      const period = periods.get(periodId);
      if (!period || period.userId !== userId) {
        return null;
      }

      return period;
    },

    createPeriodWithSeedRows: async (input) => {
      const period: ExpensePeriodRecord = {
        id: `period-${periods.size + 1}`,
        userId: input.userId,
        year: input.year,
        month: input.month,
        schema: input.schema,
        createdAt: now,
        updatedAt: now,
      };

      periods.set(period.id, period);
      periodByMonth.set(periodKey(input.userId, input.year, input.month), period.id);

      input.seedRows.forEach((seedRow, index) => {
        const rowId = `seed-row-${period.id}-${index}`;
        rows.set(rowId, {
          id: rowId,
          periodId: period.id,
          userId: input.userId,
          position: index,
          cells: {
            expense: seedRow.expense,
            ...(seedRow.amount !== undefined ? { amount: seedRow.amount } : {}),
            ...(seedRow.comment !== undefined ? { comment: seedRow.comment } : {}),
          },
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        });
      });

      return period;
    },

    updatePeriodSchema: async ({ periodId, userId, schema }) => {
      const period = periods.get(periodId);
      if (!period || period.userId !== userId) {
        return null;
      }

      const updated = {
        ...period,
        schema,
        updatedAt: now,
      };

      periods.set(periodId, updated);
      return updated;
    },

    listRowsByPeriod: async ({ periodId, userId }) => {
      return [...rows.values()]
        .filter((row) => row.periodId === periodId && row.userId === userId && !row.deletedAt)
        .sort((left, right) => left.position - right.position);
    },

    listTrashRowsByPeriod: async ({ periodId, userId }) => {
      return [...rows.values()]
        .filter((row) => row.periodId === periodId && row.userId === userId && row.deletedAt)
        .sort((left, right) => {
          const leftDeleted = left.deletedAt?.getTime() ?? 0;
          const rightDeleted = right.deletedAt?.getTime() ?? 0;
          return rightDeleted - leftDeleted;
        });
    },

    countActiveRowsByPeriod: async ({ periodId, userId }) => {
      return [...rows.values()].filter(
        (row) => row.periodId === periodId && row.userId === userId && !row.deletedAt,
      ).length;
    },

    createRow: async (input) => {
      const row: ExpenseRowRecord = {
        id: `row-${rows.size + 1}`,
        periodId: input.periodId,
        userId: input.userId,
        position: input.position,
        cells: input.cells,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      rows.set(row.id, row);
      return row;
    },

    findRowByIdForUser: async ({ rowId, userId }) => {
      const row = rows.get(rowId);
      if (!row || row.userId !== userId) {
        return null;
      }

      return row;
    },

    patchRow: async ({ rowId, userId, patch }) => {
      const existing = rows.get(rowId);
      if (!existing || existing.userId !== userId) {
        return null;
      }

      const updated: ExpenseRowRecord = {
        ...existing,
        ...(patch.cells !== undefined ? { cells: patch.cells } : {}),
        ...(patch.position !== undefined ? { position: patch.position } : {}),
        ...(patch.deletedAt !== undefined ? { deletedAt: patch.deletedAt } : {}),
        updatedAt: patch.updatedAt ?? now,
      };

      rows.set(rowId, updated);
      return updated;
    },
  };
};

const createGuestAccessMiddleware = (): RequestHandler => {
  return (request, _response, next) => {
    const guestUserId = request.header('x-guest-user-id');
    if (!guestUserId) {
      next(new Error('Missing guest user id'));
      return;
    }

    (request as express.Request & { authUser: { userId: string; username: string } }).authUser = {
      userId: guestUserId,
      username: `__web_guest_user__${guestUserId}`,
    };
    next();
  };
};

const startServer = async (
  repository: ExpensesRepository,
): Promise<Readonly<{ baseUrl: string; close: () => Promise<void> }>> => {
  const service = createExpensesService({
    expensesRepository: repository,
    now: () => now,
  });

  const app = express();
  app.use(express.json());
  app.use('/api/expenses', createExpensesRoutes({ service }));
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

const startGuestServer = async (
  repository: ExpensesRepository,
): Promise<Readonly<{ baseUrl: string; close: () => Promise<void> }>> => {
  const service = createExpensesService({
    expensesRepository: repository,
    now: () => now,
  });

  const app = express();
  app.use(express.json());
  app.use(
    '/api/expenses',
    createExpensesRoutes({
      service,
      requireAccess: createGuestAccessMiddleware(),
    }),
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

test('expenses routes bootstrap settings on GET /settings', async () => {
  const repository = createInMemoryExpensesRepository();
  const server = await startServer(repository);
  const token = await createAccessToken('user-1');

  try {
    const response = await fetch(`${server.baseUrl}/api/expenses/settings`, {
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      settings: { defaultSchema: { columns: ReadonlyArray<unknown> }; seedRows: ReadonlyArray<unknown> };
    };
    assert.equal(payload.settings.defaultSchema.columns.length, 5);
    assert.deepEqual(payload.settings.seedRows, []);
  } finally {
    await server.close();
  }
});

test('expenses routes get or create current period idempotently', async () => {
  const repository = createInMemoryExpensesRepository();
  const server = await startServer(repository);
  const token = await createAccessToken('user-1');

  try {
    const first = await fetch(`${server.baseUrl}/api/expenses/periods/current`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(first.status, 200);
    const firstPayload = (await first.json()) as {
      period: { id: string; year: number; month: number; label: string };
      rows: ReadonlyArray<unknown>;
      sum: number;
    };
    assert.equal(firstPayload.period.year, 2026);
    assert.equal(firstPayload.period.month, 6);
    assert.equal(firstPayload.period.label, 'June 2026');

    const second = await fetch(`${server.baseUrl}/api/expenses/periods/current`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(second.status, 200);
    const secondPayload = (await second.json()) as { period: { id: string } };
    assert.equal(secondPayload.period.id, firstPayload.period.id);
  } finally {
    await server.close();
  }
});

test('expenses routes return 404 for by-month when period does not exist', async () => {
  const repository = createInMemoryExpensesRepository();
  const server = await startServer(repository);
  const token = await createAccessToken('user-1');

  try {
    const response = await fetch(`${server.baseUrl}/api/expenses/periods/by-month?year=2026&month=12`, {
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(response.status, 404);
  } finally {
    await server.close();
  }
});

test('expenses routes create period with seed rows and reject duplicates', async () => {
  const repository = createInMemoryExpensesRepository({
    settings: {
      userId: 'user-1',
      defaultSchema: DEFAULT_EXPENSE_SCHEMA,
      seedRows: [{ expense: 'Initial budgets', amount: 16500 }],
      updatedAt: now,
    },
  });
  const server = await startServer(repository);
  const token = await createAccessToken('user-1');

  try {
    const createResponse = await fetch(`${server.baseUrl}/api/expenses/periods`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ year: 2026, month: 7 }),
    });

    assert.equal(createResponse.status, 201);
    const created = (await createResponse.json()) as {
      period: { month: number; label: string };
      rows: ReadonlyArray<{ cells: { expense: string; amount: number } }>;
      sum: number;
    };
    assert.equal(created.period.month, 7);
    assert.equal(created.period.label, 'July 2026');
    assert.equal(created.rows.length, 1);
    assert.equal(created.rows[0]?.cells.expense, 'Initial budgets');
    assert.equal(created.sum, 16500);

    const duplicateResponse = await fetch(`${server.baseUrl}/api/expenses/periods`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ year: 2026, month: 7 }),
    });

    assert.equal(duplicateResponse.status, 409);
  } finally {
    await server.close();
  }
});

test('expenses routes support row create and patch with sum updates', async () => {
  const repository = createInMemoryExpensesRepository({
    periods: [
      {
        id: 'period-1',
        userId: 'user-1',
        year: 2026,
        month: 6,
        schema: DEFAULT_EXPENSE_SCHEMA,
        createdAt: now,
        updatedAt: now,
      },
    ],
    rows: [
      {
        id: 'row-1',
        periodId: 'period-1',
        userId: 'user-1',
        position: 0,
        cells: { expense: 'seed', amount: 100 },
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
  const server = await startServer(repository);
  const token = await createAccessToken('user-1');

  try {
    const createRowResponse = await fetch(`${server.baseUrl}/api/expenses/periods/period-1/rows`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        cells: { expense: 'winmart', amount: -76 },
      }),
    });

    assert.equal(createRowResponse.status, 201);
    const createdRow = (await createRowResponse.json()) as {
      row: { id: string; cells: { expense: string; amount: number; comment: string } };
    };
    assert.equal(createdRow.row.cells.expense, 'winmart');
    assert.equal(createdRow.row.cells.amount, -76);
    assert.equal(createdRow.row.cells.comment, '');

    const patchRowResponse = await fetch(`${server.baseUrl}/api/expenses/rows/${createdRow.row.id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        cells: { amount: 200 },
      }),
    });

    assert.equal(patchRowResponse.status, 200);
    const patchedRow = (await patchRowResponse.json()) as {
      row: { cells: { amount: number } };
    };
    assert.equal(patchedRow.row.cells.amount, 200);

    const periodResponse = await fetch(`${server.baseUrl}/api/expenses/periods/period-1`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(periodResponse.status, 200);
    const periodPayload = (await periodResponse.json()) as { sum: number };
    assert.equal(periodPayload.sum, 300);
  } finally {
    await server.close();
  }
});

test('expenses routes enforce ownership by user-scoped lookups', async () => {
  const repository = createInMemoryExpensesRepository({
    periods: [
      {
        id: 'period-owner',
        userId: 'owner',
        year: 2026,
        month: 6,
        schema: DEFAULT_EXPENSE_SCHEMA,
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
  const server = await startServer(repository);
  const ownerToken = await createAccessToken('owner');
  const otherToken = await createAccessToken('other');

  try {
    const forbidden = await fetch(`${server.baseUrl}/api/expenses/periods/period-owner`, {
      headers: { authorization: `Bearer ${otherToken}` },
    });

    assert.equal(forbidden.status, 404);

    const allowed = await fetch(`${server.baseUrl}/api/expenses/periods/period-owner`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    assert.equal(allowed.status, 200);
  } finally {
    await server.close();
  }
});

test('expenses routes support row delete, trash list, and restore', async () => {
  const repository = createInMemoryExpensesRepository({
    periods: [
      {
        id: 'period-1',
        userId: 'user-1',
        year: 2026,
        month: 6,
        schema: DEFAULT_EXPENSE_SCHEMA,
        createdAt: now,
        updatedAt: now,
      },
    ],
    rows: [
      {
        id: 'row-1',
        periodId: 'period-1',
        userId: 'user-1',
        position: 0,
        cells: { expense: 'Coffee', amount: 50 },
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'row-2',
        periodId: 'period-1',
        userId: 'user-1',
        position: 1,
        cells: { expense: 'Lunch', amount: 120 },
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
  const server = await startServer(repository);
  const token = await createAccessToken('user-1');

  try {
    const deleteResponse = await fetch(`${server.baseUrl}/api/expenses/rows/row-1`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(deleteResponse.status, 200);
    const deletedPayload = (await deleteResponse.json()) as {
      row: { id: string; deletedAt: string };
    };
    assert.equal(deletedPayload.row.id, 'row-1');
    assert.ok(deletedPayload.row.deletedAt);

    const periodResponse = await fetch(`${server.baseUrl}/api/expenses/periods/period-1`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(periodResponse.status, 200);
    const periodPayload = (await periodResponse.json()) as {
      rows: ReadonlyArray<{ id: string }>;
      sum: number;
    };
    assert.equal(periodPayload.rows.length, 1);
    assert.equal(periodPayload.rows[0]?.id, 'row-2');
    assert.equal(periodPayload.sum, 120);

    const trashResponse = await fetch(`${server.baseUrl}/api/expenses/periods/period-1/trash`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(trashResponse.status, 200);
    const trashPayload = (await trashResponse.json()) as {
      rows: ReadonlyArray<{ id: string }>;
    };
    assert.equal(trashPayload.rows.length, 1);
    assert.equal(trashPayload.rows[0]?.id, 'row-1');

    const restoreResponse = await fetch(`${server.baseUrl}/api/expenses/rows/row-1/restore`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(restoreResponse.status, 200);
    const restoredPayload = (await restoreResponse.json()) as {
      row: { id: string; deletedAt: null };
    };
    assert.equal(restoredPayload.row.id, 'row-1');
    assert.equal(restoredPayload.row.deletedAt, null);

    const periodAfterRestore = await fetch(`${server.baseUrl}/api/expenses/periods/period-1`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const restoredPeriodPayload = (await periodAfterRestore.json()) as {
      rows: ReadonlyArray<{ id: string }>;
      sum: number;
    };
    assert.equal(restoredPeriodPayload.rows.length, 2);
    assert.equal(restoredPeriodPayload.sum, 170);
  } finally {
    await server.close();
  }
});

test('expenses routes scope guest data separately from authenticated users', async () => {
  const repository = createInMemoryExpensesRepository();
  const guestServer = await startGuestServer(repository);
  const authServer = await startServer(repository);
  const authToken = await createAccessToken('user-auth');

  try {
    const guestResponse = await fetch(`${guestServer.baseUrl}/api/expenses/periods/current`, {
      headers: {
        'x-guest-user-id': 'web-guest-123e4567-e89b-12d3-a456-426614174000',
      },
    });
    assert.equal(guestResponse.status, 200);
    const guestPayload = (await guestResponse.json()) as { period: { id: string } };

    const authResponse = await fetch(`${authServer.baseUrl}/api/expenses/periods/current`, {
      headers: { authorization: `Bearer ${authToken}` },
    });
    assert.equal(authResponse.status, 200);
    const authPayload = (await authResponse.json()) as { period: { id: string } };

    assert.notEqual(guestPayload.period.id, authPayload.period.id);
  } finally {
    await guestServer.close();
    await authServer.close();
  }
});