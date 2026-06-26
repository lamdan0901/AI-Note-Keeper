import { NextRequest, NextResponse } from "next/server";
import type { z } from "zod";

import { AppError } from "@backend/middleware/error-middleware";

import {
  isAuthHandlerResult,
  toAuthHandlerResponse,
} from "@/http/auth/post-handler";
import { parseCookies } from "@/http/auth/transport";
import { applyCorsHeaders, handleCorsPreflight } from "@/http/cors";
import { toErrorResponse } from "@/http/errors";
import type { PostHandlerHook, RequestContext, RouteContext } from "@/http/types";
import { parseOrThrow } from "@/http/validate";
import { assertHealthyDependencies } from "@/server/dependency-gate";

type ValidationSchemas = Readonly<{
  body?: z.ZodType<unknown>;
  params?: z.ZodType<unknown>;
  query?: z.ZodType<unknown>;
}>;

export type ApiMiddleware = (ctx: RequestContext) => void | Promise<void>;

export type ApiHandlerResult =
  | unknown
  | AppError
  | Response
  | NextResponse;

export type ApiHandler = (
  ctx: RequestContext,
) => ApiHandlerResult | Promise<ApiHandlerResult>;

export type WithApiHandlerOptions = Readonly<{
  validation?: ValidationSchemas;
  middleware?: ReadonlyArray<ApiMiddleware>;
  postHandler?: PostHandlerHook;
  requireHealthyDependencies?: boolean;
  cors?: boolean;
}>;

const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD", "OPTIONS"]);

const resolveClientIp = (request: NextRequest): string | null => {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp && realIp.length > 0 ? realIp : null;
};

const resolveForwardedProto = (request: NextRequest): string | null => {
  const headerValue = request.headers.get("x-forwarded-proto");
  if (!headerValue) {
    return null;
  }

  const trimmed = headerValue.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseJsonBody = async (request: NextRequest): Promise<unknown> => {
  if (METHODS_WITHOUT_BODY.has(request.method)) {
    return undefined;
  }

  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().includes("application/json")) {
    return undefined;
  }

  return request.json();
};

const resolveRouteParams = async (
  routeContext?: RouteContext,
): Promise<Readonly<Record<string, string>>> => {
  if (!routeContext?.params) {
    return {};
  }

  const params = routeContext.params;
  if (params instanceof Promise) {
    return await params;
  }

  return params;
};

const applyValidation = (
  ctx: RequestContext,
  validation: ValidationSchemas,
): RequestContext => {
  let nextCtx = ctx;

  if (validation.body) {
    nextCtx = {
      ...nextCtx,
      body: parseOrThrow(validation.body, nextCtx.body),
    };
  }

  if (validation.params) {
    nextCtx = {
      ...nextCtx,
      params: parseOrThrow(validation.params, nextCtx.params) as Readonly<
        Record<string, string>
      >,
    };
  }

  if (validation.query) {
    nextCtx = {
      ...nextCtx,
      query: parseOrThrow(validation.query, nextCtx.query) as Readonly<
        Record<string, string>
      >,
    };
  }

  return nextCtx;
};

const buildRequestContext = async (
  request: NextRequest,
  routeContext?: RouteContext,
): Promise<RequestContext> => {
  const params = await resolveRouteParams(routeContext);
  const body = await parseJsonBody(request);

  return {
    request,
    method: request.method,
    url: request.nextUrl,
    headers: request.headers,
    body,
    params,
    query: Object.fromEntries(request.nextUrl.searchParams.entries()),
    cookies: parseCookies(request),
    clientIp: resolveClientIp(request),
    forwardedProto: resolveForwardedProto(request),
  };
};

const toSuccessResponse = (result: ApiHandlerResult): NextResponse => {
  if (result instanceof NextResponse) {
    return result;
  }

  if (result instanceof Response) {
    return new NextResponse(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
    });
  }

  return NextResponse.json(result, { status: 200 });
};

export const withApiHandler = (
  handler: ApiHandler,
  options?: WithApiHandlerOptions,
): ((request: NextRequest, routeContext?: RouteContext) => Promise<NextResponse>) => {
  return async (request, routeContext) => {
    const corsEnabled = options?.cors ?? true;

    if (corsEnabled) {
      const preflightResponse = handleCorsPreflight(request);
      if (preflightResponse) {
        return preflightResponse;
      }
    }

    const finalizeResponse = (response: NextResponse): NextResponse => {
      if (!corsEnabled) {
        return response;
      }

      return applyCorsHeaders(request, response);
    };

    try {
      if (options?.requireHealthyDependencies) {
        assertHealthyDependencies();
      }

      let ctx = await buildRequestContext(request, routeContext);

      for (const middleware of options?.middleware ?? []) {
        await middleware(ctx);
      }

      if (options?.validation) {
        ctx = applyValidation(ctx, options.validation);
      }

      const result = await handler(ctx);

      let response: NextResponse;
      if (result instanceof AppError) {
        response = toErrorResponse(result, request);
      } else if (isAuthHandlerResult(result)) {
        response = toAuthHandlerResponse(result);
      } else {
        response = toSuccessResponse(result);
      }

      if (options?.postHandler) {
        const modified = await options.postHandler(ctx, response, result);
        if (modified) {
          response = modified;
        }
      }

      return finalizeResponse(response);
    } catch (error) {
      return finalizeResponse(toErrorResponse(error, request));
    }
  };
};