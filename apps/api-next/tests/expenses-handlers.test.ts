import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_EXPENSE_SCHEMA,
  type ExpensePeriodSummary,
  type ExpenseRowRecord,
  type ExpenseUserSettingsRecord,
} from "@backend/expenses/contracts.js";
import type { ExpensePeriodWithRows, ExpensesService } from "@backend/expenses/service";
import { AppError } from "@backend/middleware/error-middleware";

import { createCreatePeriodHandler } from "../src/handlers/expenses/create-period";
import { createCreateRowHandler } from "../src/handlers/expenses/create-row";
import { createDeleteRowHandler } from "../src/handlers/expenses/delete-row";
import { createFindPeriodByMonthHandler } from "../src/handlers/expenses/find-period-by-month";
import { createGetCurrentPeriodHandler } from "../src/handlers/expenses/get-current-period";
import { createGetPeriodHandler } from "../src/handlers/expenses/get-period";
import { createGetSettingsHandler } from "../src/handlers/expenses/get-settings";
import { createListPeriodsHandler } from "../src/handlers/expenses/list-periods";
import { createListTrashRowsHandler } from "../src/handlers/expenses/list-trash-rows";
import { createRestoreRowHandler } from "../src/handlers/expenses/restore-row";
import { createUpdatePeriodSchemaHandler } from "../src/handlers/expenses/update-period-schema";
import { createUpdateRowHandler } from "../src/handlers/expenses/update-row";
import { createUpdateSettingsHandler } from "../src/handlers/expenses/update-settings";
import type { AuthenticatedContext } from "../src/http/types";

const AUTH_USER_ID = "auth-user-123";

const sampleSettings = (): ExpenseUserSettingsRecord => ({
  userId: AUTH_USER_ID,
  defaultSchema: DEFAULT_EXPENSE_SCHEMA,
  seedRows: [{ expense: "rent", amount: 1200 }],
  updatedAt: new Date("2026-06-26T00:00:00.000Z"),
});

const samplePeriodSummary = (): ExpensePeriodSummary => ({
  id: "period-1",
  userId: AUTH_USER_ID,
  year: 2026,
  month: 6,
  label: "June 2026",
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  updatedAt: new Date("2026-06-26T00:00:00.000Z"),
});

const sampleRow = (): ExpenseRowRecord => ({
  id: "row-1",
  periodId: "period-1",
  userId: AUTH_USER_ID,
  position: 0,
  cells: { expense: "groceries", amount: 42.5 },
  deletedAt: null,
  createdAt: new Date("2026-06-02T00:00:00.000Z"),
  updatedAt: new Date("2026-06-26T00:00:00.000Z"),
});

const samplePeriodWithRows = (): ExpensePeriodWithRows => ({
  period: {
    id: "period-1",
    userId: AUTH_USER_ID,
    year: 2026,
    month: 6,
    schema: DEFAULT_EXPENSE_SCHEMA,
    label: "June 2026",
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-26T00:00:00.000Z"),
  },
  rows: [sampleRow()],
  sum: 42.5,
});

const createAuthContext = (
  input: Readonly<{
    body?: unknown;
    params?: Readonly<Record<string, string>>;
    query?: Readonly<Record<string, string>>;
  }> = {},
): AuthenticatedContext => ({
  request: {} as AuthenticatedContext["request"],
  method: "GET",
  url: new URL("http://localhost/api/expenses/settings"),
  headers: new Headers(),
  body: input.body ?? null,
  params: input.params ?? {},
  query: input.query ?? {},
  cookies: {},
  clientIp: null,
  forwardedProto: null,
  authUser: { userId: AUTH_USER_ID, username: "alice" },
});

const createExpensesServiceDouble = () => {
  const calls: Array<Readonly<{ method: string; args: Record<string, unknown> }>> = [];

  const expensesService: ExpensesService = {
    getOrCreateSettings: async (input) => {
      calls.push({ method: "getOrCreateSettings", args: input as Record<string, unknown> });
      return sampleSettings();
    },
    updateSettings: async (input) => {
      calls.push({ method: "updateSettings", args: input as Record<string, unknown> });
      return sampleSettings();
    },
    listPeriodSummaries: async (input) => {
      calls.push({ method: "listPeriodSummaries", args: input as Record<string, unknown> });
      return [samplePeriodSummary()];
    },
    findPeriodByMonth: async (input) => {
      calls.push({ method: "findPeriodByMonth", args: input as Record<string, unknown> });
      return samplePeriodWithRows();
    },
    getOrCreateCurrentPeriod: async (input) => {
      calls.push({ method: "getOrCreateCurrentPeriod", args: input as Record<string, unknown> });
      return samplePeriodWithRows();
    },
    createPeriod: async (input) => {
      calls.push({ method: "createPeriod", args: input as Record<string, unknown> });
      return samplePeriodWithRows();
    },
    getPeriodWithRows: async (input) => {
      calls.push({ method: "getPeriodWithRows", args: input as Record<string, unknown> });
      return samplePeriodWithRows();
    },
    updatePeriodSchema: async (input) => {
      calls.push({ method: "updatePeriodSchema", args: input as Record<string, unknown> });
      return samplePeriodWithRows().period;
    },
    createRow: async (input) => {
      calls.push({ method: "createRow", args: input as Record<string, unknown> });
      return sampleRow();
    },
    updateRow: async (input) => {
      calls.push({ method: "updateRow", args: input as Record<string, unknown> });
      return { ...sampleRow(), cells: { expense: "groceries", amount: 99 } };
    },
    deleteRow: async (input) => {
      calls.push({ method: "deleteRow", args: input as Record<string, unknown> });
      return { ...sampleRow(), deletedAt: new Date("2026-06-27T00:00:00.000Z") };
    },
    listTrashRows: async (input) => {
      calls.push({ method: "listTrashRows", args: input as Record<string, unknown> });
      return [{ ...sampleRow(), deletedAt: new Date("2026-06-25T00:00:00.000Z") }];
    },
    restoreRow: async (input) => {
      calls.push({ method: "restoreRow", args: input as Record<string, unknown> });
      return sampleRow();
    },
  };

  return { expensesService, calls };
};

test("createGetSettingsHandler delegates to expensesService.getOrCreateSettings", async () => {
  const { expensesService, calls } = createExpensesServiceDouble();
  const handler = createGetSettingsHandler(expensesService);

  const result = await handler(createAuthContext());

  assert.equal(calls[0]?.method, "getOrCreateSettings");
  assert.equal(calls[0]?.args.userId, AUTH_USER_ID);
  assert.deepStrictEqual(result, { settings: sampleSettings() });
});

test("createUpdateSettingsHandler delegates defaultSchema and seedRows", async () => {
  const { expensesService, calls } = createExpensesServiceDouble();
  const handler = createUpdateSettingsHandler(expensesService);

  const body = {
    defaultSchema: DEFAULT_EXPENSE_SCHEMA,
    seedRows: [{ expense: "utilities", amount: 80 }],
  };

  const result = await handler(createAuthContext({ body }));

  assert.equal(calls[0]?.method, "updateSettings");
  assert.deepStrictEqual(calls[0]?.args, {
    userId: AUTH_USER_ID,
    defaultSchema: body.defaultSchema,
    seedRows: body.seedRows,
  });
  assert.deepStrictEqual(result, { settings: sampleSettings() });
});

test("createListPeriodsHandler returns period summaries", async () => {
  const { expensesService, calls } = createExpensesServiceDouble();
  const handler = createListPeriodsHandler(expensesService);

  const result = await handler(createAuthContext());

  assert.equal(calls[0]?.method, "listPeriodSummaries");
  assert.equal(calls[0]?.args.userId, AUTH_USER_ID);
  assert.deepStrictEqual(result, { periods: [samplePeriodSummary()] });
});

test("createGetCurrentPeriodHandler returns period with rows", async () => {
  const { expensesService, calls } = createExpensesServiceDouble();
  const handler = createGetCurrentPeriodHandler(expensesService);

  const result = await handler(createAuthContext());

  assert.equal(calls[0]?.method, "getOrCreateCurrentPeriod");
  assert.equal(calls[0]?.args.userId, AUTH_USER_ID);
  assert.deepStrictEqual(result, samplePeriodWithRows());
});

test("createFindPeriodByMonthHandler coerces query and delegates to service", async () => {
  const { expensesService, calls } = createExpensesServiceDouble();
  const handler = createFindPeriodByMonthHandler(expensesService);

  const result = await handler(
    createAuthContext({
      query: { year: "2026", month: "6" },
    }),
  );

  assert.equal(calls[0]?.method, "findPeriodByMonth");
  assert.deepStrictEqual(calls[0]?.args, {
    userId: AUTH_USER_ID,
    year: 2026,
    month: 6,
  });
  assert.deepStrictEqual(result, samplePeriodWithRows());
});

test("createFindPeriodByMonthHandler throws not_found when service returns null", async () => {
  const expensesService: ExpensesService = {
    ...createExpensesServiceDouble().expensesService,
    findPeriodByMonth: async () => null,
  };
  const handler = createFindPeriodByMonthHandler(expensesService);

  await assert.rejects(
    () =>
      handler(
        createAuthContext({
          query: { year: "2025", month: "12" },
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "not_found");
      assert.equal(error.message, "Expense period not found for 2025-12");
      return true;
    },
  );
});

test("createCreatePeriodHandler delegates year and month from body", async () => {
  const { expensesService, calls } = createExpensesServiceDouble();
  const handler = createCreatePeriodHandler(expensesService);

  const result = await handler(
    createAuthContext({
      body: { year: 2026, month: 7 },
    }),
  );

  assert.equal(calls[0]?.method, "createPeriod");
  assert.deepStrictEqual(calls[0]?.args, {
    userId: AUTH_USER_ID,
    year: 2026,
    month: 7,
  });
  assert.deepStrictEqual(result, samplePeriodWithRows());
});

test("createGetPeriodHandler delegates periodId from params", async () => {
  const { expensesService, calls } = createExpensesServiceDouble();
  const handler = createGetPeriodHandler(expensesService);

  const result = await handler(
    createAuthContext({
      params: { periodId: "period-42" },
    }),
  );

  assert.equal(calls[0]?.method, "getPeriodWithRows");
  assert.deepStrictEqual(calls[0]?.args, {
    userId: AUTH_USER_ID,
    periodId: "period-42",
  });
  assert.deepStrictEqual(result, samplePeriodWithRows());
});

test("createListTrashRowsHandler returns trashed rows for period", async () => {
  const { expensesService, calls } = createExpensesServiceDouble();
  const handler = createListTrashRowsHandler(expensesService);

  const result = await handler(
    createAuthContext({
      params: { periodId: "period-1" },
    }),
  );

  assert.equal(calls[0]?.method, "listTrashRows");
  assert.deepStrictEqual(calls[0]?.args, {
    userId: AUTH_USER_ID,
    periodId: "period-1",
  });
  assert.equal(result.rows.length, 1);
  assert.ok(result.rows[0]?.deletedAt instanceof Date);
});

test("createCreateRowHandler delegates periodId and cells to service", async () => {
  const { expensesService, calls } = createExpensesServiceDouble();
  const handler = createCreateRowHandler(expensesService);

  const result = await handler(
    createAuthContext({
      params: { periodId: "period-1" },
      body: { cells: { expense: "winmart", amount: -76 } },
    }),
  );

  assert.equal(calls[0]?.method, "createRow");
  assert.deepStrictEqual(calls[0]?.args, {
    userId: AUTH_USER_ID,
    periodId: "period-1",
    cells: { expense: "winmart", amount: -76 },
  });
  assert.deepStrictEqual(result, { row: sampleRow() });
});

test("createUpdateRowHandler delegates rowId, cells, and position to service", async () => {
  const { expensesService, calls } = createExpensesServiceDouble();
  const handler = createUpdateRowHandler(expensesService);

  const result = await handler(
    createAuthContext({
      params: { rowId: "row-1" },
      body: { cells: { amount: 200 }, position: 2 },
    }),
  );

  assert.equal(calls[0]?.method, "updateRow");
  assert.deepStrictEqual(calls[0]?.args, {
    userId: AUTH_USER_ID,
    rowId: "row-1",
    cells: { amount: 200 },
    position: 2,
  });
  assert.deepStrictEqual(result, {
    row: { ...sampleRow(), cells: { expense: "groceries", amount: 99 } },
  });
});

test("createDeleteRowHandler delegates rowId to service", async () => {
  const { expensesService, calls } = createExpensesServiceDouble();
  const handler = createDeleteRowHandler(expensesService);

  const result = await handler(
    createAuthContext({
      params: { rowId: "row-1" },
    }),
  );

  assert.equal(calls[0]?.method, "deleteRow");
  assert.deepStrictEqual(calls[0]?.args, {
    userId: AUTH_USER_ID,
    rowId: "row-1",
  });
  assert.ok(result.row.deletedAt instanceof Date);
});

test("createRestoreRowHandler delegates rowId to service", async () => {
  const { expensesService, calls } = createExpensesServiceDouble();
  const handler = createRestoreRowHandler(expensesService);

  const result = await handler(
    createAuthContext({
      params: { rowId: "row-1" },
    }),
  );

  assert.equal(calls[0]?.method, "restoreRow");
  assert.deepStrictEqual(calls[0]?.args, {
    userId: AUTH_USER_ID,
    rowId: "row-1",
  });
  assert.deepStrictEqual(result, { row: sampleRow() });
});

test("createUpdateRowHandler propagates not_found from service", async () => {
  const expensesService: ExpensesService = {
    ...createExpensesServiceDouble().expensesService,
    updateRow: async () => {
      throw new AppError({ code: "not_found", message: "Expense row not found" });
    },
  };
  const handler = createUpdateRowHandler(expensesService);

  await assert.rejects(
    () =>
      handler(
        createAuthContext({
          params: { rowId: "missing-row" },
          body: { cells: { amount: 1 } },
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "not_found");
      assert.equal(error.message, "Expense row not found");
      return true;
    },
  );
});

test("createUpdatePeriodSchemaHandler delegates schema from body", async () => {
  const { expensesService, calls } = createExpensesServiceDouble();
  const handler = createUpdatePeriodSchemaHandler(expensesService);

  const result = await handler(
    createAuthContext({
      params: { periodId: "period-1" },
      body: { schema: DEFAULT_EXPENSE_SCHEMA },
    }),
  );

  assert.equal(calls[0]?.method, "updatePeriodSchema");
  assert.deepStrictEqual(calls[0]?.args, {
    userId: AUTH_USER_ID,
    periodId: "period-1",
    schema: DEFAULT_EXPENSE_SCHEMA,
  });
  assert.deepStrictEqual(result, { period: samplePeriodWithRows().period });
});