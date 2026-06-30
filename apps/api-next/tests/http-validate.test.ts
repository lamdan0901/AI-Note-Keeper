import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { z } from "zod";

import { AppError } from "@backend/middleware/error-middleware";

import {
  parseOrThrow,
  validateBody,
  validateParams,
  validateQuery,
} from "../src/http/validate";

test("parseOrThrow returns parsed data on success", () => {
  const schema = z.object({ amount: z.number().positive() });
  const result = parseOrThrow(schema, { amount: 5 });

  assert.deepStrictEqual(result, { amount: 5 });
});

test("parseOrThrow throws AppError with validation code and issues shape", () => {
  const schema = z.object({ amount: z.number().positive() });

  assert.throws(
    () => parseOrThrow(schema, { amount: -5 }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "validation");
      assert.equal(error.status, 400);

      const issues = error.details?.issues as ReadonlyArray<{
        path: string;
        message: string;
        code: string;
      }>;
      assert.ok(Array.isArray(issues));
      assert.equal(issues[0]?.path, "amount");
      assert.equal(typeof issues[0]?.message, "string");
      assert.equal(typeof issues[0]?.code, "string");
      return true;
    },
  );
});

test("validateBody parses JSON body through schema", async () => {
  const schema = z.object({ amount: z.number().positive() });
  const request = new NextRequest("http://localhost:3001/validated", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amount: 10 }),
  });

  const result = await validateBody(request, schema);
  assert.deepStrictEqual(result, { amount: 10 });
});

test("validateParams parses route params through schema", () => {
  const schema = z.object({ id: z.string().uuid() });
  const id = "550e8400-e29b-41d4-a716-446655440000";
  const result = validateParams({ id }, schema);

  assert.deepStrictEqual(result, { id });
});

test("validateQuery parses search params through schema", () => {
  const schema = z.object({ page: z.coerce.number().int().positive() });
  const searchParams = new URLSearchParams("page=2");
  const result = validateQuery(searchParams, schema);

  assert.deepStrictEqual(result, { page: 2 });
});