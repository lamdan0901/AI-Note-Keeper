import type { NextRequest } from "next/server";
import { z } from "zod";

import { AppError } from "@backend/middleware/error-middleware";

type ValidationIssue = Readonly<{
  path: string;
  message: string;
  code: string;
}>;

const toValidationIssues = (error: z.ZodError): ReadonlyArray<ValidationIssue> => {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join(".") || "root",
    message: issue.message,
    code: issue.code,
  }));
};

export const parseOrThrow = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new AppError({
      code: "validation",
      details: {
        issues: toValidationIssues(result.error),
      },
    });
  }

  return result.data;
};

export const validateBody = async <T>(request: NextRequest, schema: z.ZodType<T>): Promise<T> => {
  const body: unknown = await request.json();
  return parseOrThrow(schema, body);
};

export const validateParams = <T>(params: unknown, schema: z.ZodType<T>): T => {
  return parseOrThrow(schema, params);
};

export const validateQuery = <T>(searchParams: URLSearchParams, schema: z.ZodType<T>): T => {
  const query = Object.fromEntries(searchParams.entries());
  return parseOrThrow(schema, query);
};