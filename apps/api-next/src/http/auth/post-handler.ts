import { NextResponse } from "next/server";

import type { AuthHandlerResult } from "@/handlers/auth/shared";
import { clearAuthTransport, writeAuthTransport } from "@/http/auth/transport";
import type { PostHandlerHook, RequestContext } from "@/http/types";

export const isAuthHandlerResult = (value: unknown): value is AuthHandlerResult => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value instanceof NextResponse ||
    value instanceof Response
  ) {
    return false;
  }

  const candidate = value as AuthHandlerResult;
  const body = candidate.body;

  return (
    typeof candidate.status === "number" &&
    typeof body === "object" &&
    body !== null &&
    !Array.isArray(body) &&
    !(body instanceof ReadableStream)
  );
};

const copyResponseCookies = (source: NextResponse, target: NextResponse): void => {
  for (const cookie of source.cookies.getAll()) {
    target.cookies.set(cookie.name, cookie.value, {
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite as "lax" | "strict" | "none" | undefined,
      secure: cookie.secure,
      path: cookie.path,
      expires: cookie.expires,
      maxAge: cookie.maxAge,
    });
  }
};

export const toAuthHandlerResponse = (result: AuthHandlerResult): NextResponse => {
  if (result.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  return NextResponse.json(result.body, { status: result.status });
};

export const applyAuthTransport = (
  ctx: RequestContext,
  response: NextResponse,
  result: AuthHandlerResult,
): NextResponse => {
  if (result.clearTransport) {
    clearAuthTransport(ctx.request, response);
    return response;
  }

  if (!result.tokens) {
    return response;
  }

  const cookieScratch = new NextResponse(null);
  const transport = writeAuthTransport(ctx.request, cookieScratch, result.tokens);
  const nextResponse = NextResponse.json(
    {
      ...result.body,
      transport: transport.transport,
    },
    { status: result.status },
  );
  copyResponseCookies(cookieScratch, nextResponse);
  return nextResponse;
};

export const createAuthPostHandler = (): PostHandlerHook => {
  return (ctx, response, result) => {
    if (!isAuthHandlerResult(result)) {
      return response;
    }

    return applyAuthTransport(ctx, response, result);
  };
};