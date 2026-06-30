import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { createTokenFactory } from "@backend/auth/tokens";
import { DEFAULT_EXPENSE_SCHEMA } from "@backend/expenses/contracts.js";

import { resetGuestRateLimitStateForTests } from "../src/http/auth/require-access";
import {
  createInMemoryExpensesRepository,
  EXPENSES_TEST_NOW,
} from "./support/expenses-service-double";
import {
  authHeaders,
  DEFAULT_GUEST_USER_ID,
  guestHeaders,
  jsonAuthHeaders,
  startExpensesTestServer,
} from "./support/expenses-test-server";

const createAccessToken = async (userId: string): Promise<string> => {
  const tokenFactory = createTokenFactory();
  const pair = await tokenFactory.issueTokenPair({
    userId,
    username: userId,
  });

  return pair.accessToken;
};

afterEach(() => {
  resetGuestRateLimitStateForTests();
});

test("expenses routes bootstrap settings on GET /settings", async () => {
  const server = await startExpensesTestServer({
    authUserId: "user-1",
  });
  const token = await createAccessToken("user-1");

  try {
    const response = await server.fetch("/api/expenses/settings", {
      headers: jsonAuthHeaders(token),
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

test("expenses routes get or create current period idempotently", async () => {
  const server = await startExpensesTestServer({
    authUserId: "user-1",
  });
  const token = await createAccessToken("user-1");

  try {
    const first = await server.fetch("/api/expenses/periods/current", {
      headers: jsonAuthHeaders(token),
    });
    assert.equal(first.status, 200);
    const firstPayload = (await first.json()) as {
      period: { id: string; year: number; month: number; label: string };
      rows: ReadonlyArray<unknown>;
      sum: number;
    };
    assert.equal(firstPayload.period.year, 2026);
    assert.equal(firstPayload.period.month, 6);
    assert.equal(firstPayload.period.label, "June 2026");

    const second = await server.fetch("/api/expenses/periods/current", {
      headers: jsonAuthHeaders(token),
    });
    assert.equal(second.status, 200);
    const secondPayload = (await second.json()) as { period: { id: string } };
    assert.equal(secondPayload.period.id, firstPayload.period.id);
  } finally {
    await server.close();
  }
});

test("expenses routes return 404 for by-month when period does not exist", async () => {
  const server = await startExpensesTestServer({
    authUserId: "user-1",
  });
  const token = await createAccessToken("user-1");

  try {
    const response = await server.fetch("/api/expenses/periods/by-month?year=2026&month=12", {
      headers: jsonAuthHeaders(token),
    });

    assert.equal(response.status, 404);
  } finally {
    await server.close();
  }
});

test("expenses routes create period with seed rows and reject duplicates", async () => {
  const repository = createInMemoryExpensesRepository({
    settings: {
      userId: "user-1",
      defaultSchema: DEFAULT_EXPENSE_SCHEMA,
      seedRows: [{ expense: "Initial budgets", amount: 16500 }],
      updatedAt: EXPENSES_TEST_NOW,
    },
  });
  const server = await startExpensesTestServer({
    repository,
    authUserId: "user-1",
  });
  const token = await createAccessToken("user-1");

  try {
    const createResponse = await server.fetch("/api/expenses/periods", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({ year: 2026, month: 7 }),
    });

    assert.equal(createResponse.status, 201);
    const created = (await createResponse.json()) as {
      period: { month: number; label: string };
      rows: ReadonlyArray<{ cells: { expense: string; amount: number } }>;
      sum: number;
    };
    assert.equal(created.period.month, 7);
    assert.equal(created.period.label, "July 2026");
    assert.equal(created.rows.length, 1);
    assert.equal(created.rows[0]?.cells.expense, "Initial budgets");
    assert.equal(created.sum, 16500);

    const duplicateResponse = await server.fetch("/api/expenses/periods", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({ year: 2026, month: 7 }),
    });

    assert.equal(duplicateResponse.status, 409);
  } finally {
    await server.close();
  }
});

test("expenses routes support row create and patch with sum updates", async () => {
  const repository = createInMemoryExpensesRepository({
    periods: [
      {
        id: "period-1",
        userId: "user-1",
        year: 2026,
        month: 6,
        schema: DEFAULT_EXPENSE_SCHEMA,
        createdAt: EXPENSES_TEST_NOW,
        updatedAt: EXPENSES_TEST_NOW,
      },
    ],
    rows: [
      {
        id: "row-1",
        periodId: "period-1",
        userId: "user-1",
        position: 0,
        cells: { expense: "seed", amount: 100 },
        deletedAt: null,
        createdAt: EXPENSES_TEST_NOW,
        updatedAt: EXPENSES_TEST_NOW,
      },
    ],
  });
  const server = await startExpensesTestServer({
    repository,
    authUserId: "user-1",
  });
  const token = await createAccessToken("user-1");

  try {
    const createRowResponse = await server.fetch("/api/expenses/periods/period-1/rows", {
      method: "POST",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        cells: { expense: "winmart", amount: -76 },
      }),
    });

    assert.equal(createRowResponse.status, 201);
    const createdRow = (await createRowResponse.json()) as {
      row: { id: string; cells: { expense: string; amount: number; comment: string } };
    };
    assert.equal(createdRow.row.cells.expense, "winmart");
    assert.equal(createdRow.row.cells.amount, -76);
    assert.equal(createdRow.row.cells.comment, "");

    const patchRowResponse = await server.fetch(`/api/expenses/rows/${createdRow.row.id}`, {
      method: "PATCH",
      headers: jsonAuthHeaders(token),
      body: JSON.stringify({
        cells: { amount: 200 },
      }),
    });

    assert.equal(patchRowResponse.status, 200);
    const patchedRow = (await patchRowResponse.json()) as {
      row: { cells: { amount: number } };
    };
    assert.equal(patchedRow.row.cells.amount, 200);

    const periodResponse = await server.fetch("/api/expenses/periods/period-1", {
      headers: jsonAuthHeaders(token),
    });
    assert.equal(periodResponse.status, 200);
    const periodPayload = (await periodResponse.json()) as { sum: number };
    assert.equal(periodPayload.sum, 300);
  } finally {
    await server.close();
  }
});

test("expenses routes enforce ownership by user-scoped lookups", async () => {
  const repository = createInMemoryExpensesRepository({
    periods: [
      {
        id: "period-owner",
        userId: "owner",
        year: 2026,
        month: 6,
        schema: DEFAULT_EXPENSE_SCHEMA,
        createdAt: EXPENSES_TEST_NOW,
        updatedAt: EXPENSES_TEST_NOW,
      },
    ],
  });
  const server = await startExpensesTestServer({ repository });
  const ownerToken = await createAccessToken("owner");
  const otherToken = await createAccessToken("other");

  try {
    const forbidden = await server.fetch("/api/expenses/periods/period-owner", {
      headers: jsonAuthHeaders(otherToken),
    });

    assert.equal(forbidden.status, 404);

    const allowed = await server.fetch("/api/expenses/periods/period-owner", {
      headers: jsonAuthHeaders(ownerToken),
    });

    assert.equal(allowed.status, 200);
  } finally {
    await server.close();
  }
});

test("expenses routes support row delete, trash list, and restore", async () => {
  const repository = createInMemoryExpensesRepository({
    periods: [
      {
        id: "period-1",
        userId: "user-1",
        year: 2026,
        month: 6,
        schema: DEFAULT_EXPENSE_SCHEMA,
        createdAt: EXPENSES_TEST_NOW,
        updatedAt: EXPENSES_TEST_NOW,
      },
    ],
    rows: [
      {
        id: "row-1",
        periodId: "period-1",
        userId: "user-1",
        position: 0,
        cells: { expense: "Coffee", amount: 50 },
        deletedAt: null,
        createdAt: EXPENSES_TEST_NOW,
        updatedAt: EXPENSES_TEST_NOW,
      },
      {
        id: "row-2",
        periodId: "period-1",
        userId: "user-1",
        position: 1,
        cells: { expense: "Lunch", amount: 120 },
        deletedAt: null,
        createdAt: EXPENSES_TEST_NOW,
        updatedAt: EXPENSES_TEST_NOW,
      },
    ],
  });
  const server = await startExpensesTestServer({
    repository,
    authUserId: "user-1",
  });
  const token = await createAccessToken("user-1");

  try {
    const deleteResponse = await server.fetch("/api/expenses/rows/row-1", {
      method: "DELETE",
      headers: jsonAuthHeaders(token),
    });
    assert.equal(deleteResponse.status, 200);
    const deletedPayload = (await deleteResponse.json()) as {
      row: { id: string; deletedAt: string };
    };
    assert.equal(deletedPayload.row.id, "row-1");
    assert.ok(deletedPayload.row.deletedAt);

    const periodResponse = await server.fetch("/api/expenses/periods/period-1", {
      headers: jsonAuthHeaders(token),
    });
    assert.equal(periodResponse.status, 200);
    const periodPayload = (await periodResponse.json()) as {
      rows: ReadonlyArray<{ id: string }>;
      sum: number;
    };
    assert.equal(periodPayload.rows.length, 1);
    assert.equal(periodPayload.rows[0]?.id, "row-2");
    assert.equal(periodPayload.sum, 120);

    const trashResponse = await server.fetch("/api/expenses/periods/period-1/trash", {
      headers: jsonAuthHeaders(token),
    });
    assert.equal(trashResponse.status, 200);
    const trashPayload = (await trashResponse.json()) as {
      rows: ReadonlyArray<{ id: string }>;
    };
    assert.equal(trashPayload.rows.length, 1);
    assert.equal(trashPayload.rows[0]?.id, "row-1");

    const restoreResponse = await server.fetch("/api/expenses/rows/row-1/restore", {
      method: "POST",
      headers: authHeaders(token),
    });
    assert.equal(restoreResponse.status, 200);
    const restoredPayload = (await restoreResponse.json()) as {
      row: { id: string; deletedAt: null };
    };
    assert.equal(restoredPayload.row.id, "row-1");
    assert.equal(restoredPayload.row.deletedAt, null);

    const periodAfterRestore = await server.fetch("/api/expenses/periods/period-1", {
      headers: jsonAuthHeaders(token),
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

test("expenses routes scope guest data separately from authenticated users", async () => {
  const repository = createInMemoryExpensesRepository();
  const server = await startExpensesTestServer({ repository });
  const authToken = await createAccessToken("user-auth");

  try {
    const guestResponse = await server.fetch("/api/expenses/periods/current", {
      headers: guestHeaders(DEFAULT_GUEST_USER_ID),
    });
    assert.equal(guestResponse.status, 200);
    const guestPayload = (await guestResponse.json()) as { period: { id: string } };

    const authResponse = await server.fetch("/api/expenses/periods/current", {
      headers: jsonAuthHeaders(authToken),
    });
    assert.equal(authResponse.status, 200);
    const authPayload = (await authResponse.json()) as { period: { id: string } };

    assert.notEqual(guestPayload.period.id, authPayload.period.id);
  } finally {
    await server.close();
  }
});