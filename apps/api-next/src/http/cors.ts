import { NextRequest, NextResponse } from "next/server";

export const CORS_METHODS = "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS";
export const CORS_MAX_AGE_SECONDS = "86400";

const DEFAULT_DEVELOPMENT_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
] as const;

export const resolveEffectiveAllowedOrigins = (): ReadonlyArray<string> => {
  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (allowedOrigins.length > 0) {
    return allowedOrigins;
  }

  return process.env.NODE_ENV === "production" ? [] : [...DEFAULT_DEVELOPMENT_ORIGINS];
};

export const createIsAllowedOrigin = (
  effectiveAllowedOrigins: ReadonlyArray<string> = resolveEffectiveAllowedOrigins(),
): ((origin: string) => boolean) => {
  return (origin: string): boolean => {
    if (effectiveAllowedOrigins.length === 0) {
      return false;
    }

    return effectiveAllowedOrigins.includes(origin);
  };
};

export const isPreflightRequest = (request: NextRequest): boolean => {
  const origin = request.headers.get("origin");
  const requestedMethod = request.headers.get("access-control-request-method");

  return (
    request.method === "OPTIONS" &&
    typeof origin === "string" &&
    origin.length > 0 &&
    typeof requestedMethod === "string" &&
    requestedMethod.length > 0
  );
};

export const handleCorsPreflight = (
  request: NextRequest,
  isAllowedOrigin: (origin: string) => boolean = createIsAllowedOrigin(),
): NextResponse | null => {
  if (!isPreflightRequest(request)) {
    return null;
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    return null;
  }

  const response = new NextResponse(null, { status: 204 });

  if (!isAllowedOrigin(origin)) {
    return response;
  }

  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Credentials", "true");
  response.headers.set("Vary", "Origin");
  response.headers.set("Access-Control-Allow-Methods", CORS_METHODS);

  const requestedHeaders = request.headers.get("access-control-request-headers");
  if (requestedHeaders && requestedHeaders.length > 0) {
    response.headers.set("Access-Control-Allow-Headers", requestedHeaders);
  }

  response.headers.set("Access-Control-Max-Age", CORS_MAX_AGE_SECONDS);
  return response;
};

export const applyCorsHeaders = (
  request: NextRequest,
  response: Response,
  isAllowedOrigin: (origin: string) => boolean = createIsAllowedOrigin(),
): NextResponse => {
  const origin = request.headers.get("origin");
  const nextResponse = new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });

  if (!origin || !isAllowedOrigin(origin)) {
    return nextResponse;
  }

  nextResponse.headers.set("Access-Control-Allow-Origin", origin);
  nextResponse.headers.set("Access-Control-Allow-Credentials", "true");
  nextResponse.headers.set("Vary", "Origin");
  return nextResponse;
};

type CorsRouteContext = Readonly<{
  params?: Promise<Readonly<Record<string, string>>> | Readonly<Record<string, string>>;
}>;

export const withCors = (
  handler: (
    request: NextRequest,
    routeContext?: CorsRouteContext,
  ) => Response | NextResponse | Promise<Response | NextResponse>,
): ((
  request: NextRequest,
  routeContext?: CorsRouteContext,
) => Promise<NextResponse>) => {
  return async (request, routeContext) => {
    const preflightResponse = handleCorsPreflight(request);
    if (preflightResponse) {
      return preflightResponse;
    }

    const response = await handler(request, routeContext);
    return applyCorsHeaders(request, response);
  };
};