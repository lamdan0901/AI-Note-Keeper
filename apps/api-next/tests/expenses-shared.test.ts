import assert from "node:assert/strict";
import { test } from "node:test";

import type { AuthenticatedContext } from "../src/http/types";
import {
  createExpensePeriodBodySchema,
  createExpenseRowBodySchema,
  expensePeriodByMonthQuerySchema,
  expensePeriodIdParamsSchema,
  expenseRowIdParamsSchema,
  patchExpensePeriodSchemaBodySchema,
  patchExpenseRowBodySchema,
  requireAuthUserId,
  updateExpenseSettingsBodySchema,
} from "../src/handlers/expenses/shared";

const buildAuthContext = (userId: string): AuthenticatedContext => {
  return {
    request: {} as AuthenticatedContext["request"],
    method: "GET",
    url: new URL("http://localhost/api/expenses/settings"),
    headers: new Headers(),
    body: null,
    params: {},
    query: {},
    cookies: {},
    clientIp: null,
    forwardedProto: null,
    authUser: { userId, username: "alice" },
  };
};

const minimalExpenseTableSchema = () => ({
  columns: [
    {
      id: "expense",
      name: "Expense",
      type: "text" as const,
      icon: "text" as const,
      visible: true,
      position: 0,
      defaultValue: "",
    },
  ],
});

test("requireAuthUserId reads userId from authenticated context", () => {
  const ctx = buildAuthContext("auth-user-123");

  assert.equal(requireAuthUserId(ctx), "auth-user-123");
});

test("expensePeriodByMonthQuerySchema coerces year and month query strings to integers", () => {
  const parsed = expensePeriodByMonthQuerySchema.safeParse({
    year: "2026",
    month: "6",
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.year, 2026);
    assert.equal(parsed.data.month, 6);
    assert.equal(typeof parsed.data.year, "number");
    assert.equal(typeof parsed.data.month, "number");
  }
});

test("expensePeriodByMonthQuerySchema accepts numeric year and month", () => {
  const parsed = expensePeriodByMonthQuerySchema.safeParse({
    year: 2026,
    month: 6,
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.year, 2026);
    assert.equal(parsed.data.month, 6);
  }
});

test("expensePeriodByMonthQuerySchema rejects invalid month and year ranges", () => {
  assert.equal(
    expensePeriodByMonthQuerySchema.safeParse({ year: "2026", month: "13" }).success,
    false,
  );
  assert.equal(
    expensePeriodByMonthQuerySchema.safeParse({ year: "1969", month: "1" }).success,
    false,
  );
  assert.equal(expensePeriodByMonthQuerySchema.safeParse({ year: "2026" }).success, false);
  assert.equal(expensePeriodByMonthQuerySchema.safeParse({ month: "6" }).success, false);
});

test("createExpensePeriodBodySchema rejects invalid month", () => {
  assert.equal(
    createExpensePeriodBodySchema.safeParse({ year: 2026, month: 13 }).success,
    false,
  );
  assert.equal(
    createExpensePeriodBodySchema.safeParse({ year: 2026, month: 0 }).success,
    false,
  );
});

test("expensePeriodIdParamsSchema and expenseRowIdParamsSchema require non-empty ids", () => {
  assert.equal(expensePeriodIdParamsSchema.safeParse({ periodId: "period-1" }).success, true);
  assert.equal(expensePeriodIdParamsSchema.safeParse({ periodId: "" }).success, false);
  assert.equal(expenseRowIdParamsSchema.safeParse({ rowId: "row-1" }).success, true);
  assert.equal(expenseRowIdParamsSchema.safeParse({ rowId: "" }).success, false);
});

test("updateExpenseSettingsBodySchema rejects empty columns", () => {
  assert.equal(
    updateExpenseSettingsBodySchema.safeParse({
      defaultSchema: { columns: [] },
    }).success,
    false,
  );
  assert.equal(
    updateExpenseSettingsBodySchema.safeParse({
      defaultSchema: minimalExpenseTableSchema(),
    }).success,
    true,
  );
});

test("patchExpensePeriodSchemaBodySchema requires expense table schema", () => {
  assert.equal(
    patchExpensePeriodSchemaBodySchema.safeParse({
      schema: minimalExpenseTableSchema(),
    }).success,
    true,
  );
  assert.equal(patchExpensePeriodSchemaBodySchema.safeParse({}).success, false);
});

test("createExpenseRowBodySchema accepts optional cells", () => {
  assert.equal(createExpenseRowBodySchema.safeParse({}).success, true);
  assert.equal(
    createExpenseRowBodySchema.safeParse({ cells: { expense: "groceries" } }).success,
    true,
  );
});

test("patchExpenseRowBodySchema rejects non-finite amount values", () => {
  assert.equal(
    patchExpenseRowBodySchema.safeParse({
      cells: { amount: Number.NaN },
    }).success,
    false,
  );
  assert.equal(
    patchExpenseRowBodySchema.safeParse({
      position: 0,
    }).success,
    true,
  );
});