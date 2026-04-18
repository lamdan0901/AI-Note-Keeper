import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';

import { AppError } from './error-middleware.js';

type ValidationSchemas = Readonly<{
  body?: z.ZodType<unknown>;
  params?: z.ZodType<unknown>;
  query?: z.ZodType<unknown>;
}>;

type AsyncRequestHandler = (
  request: Request,
  response: Response,
  next: NextFunction,
) => Promise<void> | void;

type ValidationIssue = Readonly<{
  path: string;
  message: string;
  code: string;
}>;

const toValidationIssues = (error: z.ZodError): ReadonlyArray<ValidationIssue> => {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.') || 'root',
    message: issue.message,
    code: issue.code,
  }));
};

const parseOrThrow = (schema: z.ZodType<unknown>, value: unknown): unknown => {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new AppError({
      code: 'validation',
      details: {
        issues: toValidationIssues(result.error),
      },
    });
  }

  return result.data;
};

export const withErrorBoundary = (handler: AsyncRequestHandler): RequestHandler => {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
};

export const validateRequest = (schemas: ValidationSchemas): RequestHandler => {
  return withErrorBoundary((request, _response, next) => {
    const nextBody = schemas.body ? parseOrThrow(schemas.body, request.body) : request.body;
    const nextParams = schemas.params
      ? parseOrThrow(schemas.params, request.params)
      : request.params;
    const nextQuery = schemas.query ? parseOrThrow(schemas.query, request.query) : request.query;

    request.body = nextBody;
    request.params = nextParams as Request['params'];
    request.query = nextQuery as Request['query'];

    next();
  });
};
