import type { ErrorRequestHandler, Request, RequestHandler } from 'express';
import { resolveErrorDefinition, type ErrorCategory } from '../errors/catalog.js';

type AppErrorInput = Readonly<{
  code: ErrorCategory;
  message?: string;
  details?: Readonly<Record<string, unknown>>;
  traceId?: string;
}>;

export type ErrorResponseBody = Readonly<{
  code: ErrorCategory;
  message: string;
  status: number;
  details?: Readonly<Record<string, unknown>>;
  traceId?: string;
}>;

export class AppError extends Error {
  public readonly code: ErrorCategory;
  public readonly status: number;
  public readonly details?: Readonly<Record<string, unknown>>;
  public readonly traceId?: string;

  constructor(input: AppErrorInput) {
    const definition = resolveErrorDefinition(input.code);
    super(input.message ?? definition.message);
    this.name = 'AppError';
    this.code = definition.code;
    this.status = definition.status;
    this.details = input.details;
    this.traceId = input.traceId;
  }
}

const CLIENT_CORRECTABLE_CODES = new Set<ErrorCategory>(['validation', 'auth', 'conflict']);
const RATE_LIMIT_DETAIL_KEYS = ['retryAfterSeconds', 'resetAt'] as const;
const UNSAFE_DETAIL_KEY_FRAGMENTS = ['stack', 'sql', 'exception', 'internal', 'cause'];

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const hasUnsafeKey = (key: string): boolean => {
  const normalized = key.toLowerCase();
  return UNSAFE_DETAIL_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
};

const sanitizeRateLimitDetails = (
  details: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | undefined => {
  const safeEntries = RATE_LIMIT_DETAIL_KEYS.flatMap((key) => {
    const value = details[key];
    return value === undefined ? [] : [[key, value] as const];
  });

  if (safeEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(safeEntries);
};

const sanitizeClientDetails = (
  details: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | undefined => {
  const safeEntries = Object.entries(details).filter(([key]) => !hasUnsafeKey(key));

  if (safeEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(safeEntries);
};

const sanitizeDetails = (
  code: ErrorCategory,
  details?: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | undefined => {
  if (!details || !isRecord(details)) {
    return undefined;
  }

  if (code === 'rate_limit') {
    return sanitizeRateLimitDetails(details);
  }

  if (!CLIENT_CORRECTABLE_CODES.has(code)) {
    return undefined;
  }

  return sanitizeClientDetails(details);
};

const readTraceId = (request: Request): string | undefined => {
  const headerValue = request.header('x-request-id');
  if (!headerValue) {
    return undefined;
  }

  const trimmed = headerValue.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toAppError = (error: unknown, request: Request): AppError => {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError({
    code: 'internal',
    traceId: readTraceId(request),
  });
};

const buildErrorResponse = (appError: AppError, request: Request): ErrorResponseBody => {
  const safeDetails = sanitizeDetails(appError.code, appError.details);
  const base: ErrorResponseBody = {
    code: appError.code,
    message: appError.message,
    status: appError.status,
  };

  const withDetails = safeDetails ? { ...base, details: safeDetails } : base;
  const traceId = appError.traceId ?? readTraceId(request);

  return traceId ? { ...withDetails, traceId } : withDetails;
};

export const notFoundMiddleware: RequestHandler = (_request, _response, next) => {
  next(new AppError({ code: 'not_found' }));
};

export const errorMiddleware: ErrorRequestHandler = (error, request, response, _next) => {
  const appError = toAppError(error, request);
  const payload = buildErrorResponse(appError, request);

  response.status(appError.status).json(payload);
};
