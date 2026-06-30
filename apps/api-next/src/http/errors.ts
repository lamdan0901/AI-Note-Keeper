import { NextRequest, NextResponse } from "next/server";

import {
  AppError,
  type ErrorResponseBody,
} from "@backend/middleware/error-middleware";
import type { ErrorCategory } from "@backend/errors/catalog";

export type { ErrorResponseBody };

const CLIENT_CORRECTABLE_CODES = new Set<ErrorCategory>(["validation", "auth", "conflict"]);
const RATE_LIMIT_DETAIL_KEYS = ["retryAfterSeconds", "resetAt"] as const;
const UNSAFE_DETAIL_KEY_FRAGMENTS = ["stack", "sql", "exception", "internal", "cause"];

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

  if (code === "rate_limit") {
    return sanitizeRateLimitDetails(details);
  }

  if (!CLIENT_CORRECTABLE_CODES.has(code)) {
    return undefined;
  }

  return sanitizeClientDetails(details);
};

const readTraceId = (request: NextRequest): string | undefined => {
  const headerValue = request.headers.get("x-request-id");
  if (!headerValue) {
    return undefined;
  }

  const trimmed = headerValue.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toAppError = (error: unknown, request: NextRequest): AppError => {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError({
    code: "internal",
    traceId: readTraceId(request),
  });
};

const buildErrorResponse = (appError: AppError, request: NextRequest): ErrorResponseBody => {
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

export const toErrorResponse = (error: unknown, request: NextRequest): NextResponse => {
  const appError = toAppError(error, request);
  const payload = buildErrorResponse(appError, request);

  return NextResponse.json(payload, { status: appError.status });
};