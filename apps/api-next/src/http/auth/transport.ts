import { type NextRequest, NextResponse } from "next/server";

import type { TokenPair } from "@backend/auth/contracts";

const REFRESH_COOKIE_NAME = "ank_refresh_token";

export const parseCookies = (request: NextRequest): Readonly<Record<string, string>> => {
  const header = request.headers.get("cookie");
  if (!header) {
    return {};
  }

  return header.split(";").reduce<Record<string, string>>((acc, pair) => {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex <= 0) {
      return acc;
    }

    const key = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    return {
      ...acc,
      [key]: decodeURIComponent(value),
    };
  }, {});
};

export const resolveRefreshToken = (
  request: NextRequest,
  explicitToken: string | undefined,
): string | null => {
  if (explicitToken) {
    return explicitToken;
  }

  const cookies = parseCookies(request);
  return cookies[REFRESH_COOKIE_NAME] ?? null;
};

export const shouldUseCookieTransport = (request: NextRequest): boolean => {
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin) {
    return true;
  }

  const transportHint = request.headers.get("x-client-platform");
  if (transportHint) {
    return transportHint.toLowerCase() === "web";
  }

  return true;
};

export const isSecureCookieRequest = (request: NextRequest): boolean => {
  if (process.env.NODE_ENV === "production") {
    return true;
  }

  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto && forwardedProto.toLowerCase() === "https") {
    return true;
  }

  return request.nextUrl.protocol === "https:";
};

export const resolveRefreshCookieSameSite = (): "lax" | "none" => {
  return process.env.NODE_ENV === "production" ? "none" : "lax";
};

const buildCookieOptions = (request: NextRequest, expiresAt: number) => {
  return {
    httpOnly: true,
    sameSite: resolveRefreshCookieSameSite(),
    secure: isSecureCookieRequest(request),
    path: "/",
    expires: new Date(expiresAt),
  };
};

export const writeAuthTransport = (
  request: NextRequest,
  response: NextResponse,
  tokenPair: TokenPair,
): Readonly<{ transport: "cookie" | "json" }> => {
  if (shouldUseCookieTransport(request)) {
    response.cookies.set(
      REFRESH_COOKIE_NAME,
      tokenPair.refreshToken,
      buildCookieOptions(request, tokenPair.refreshExpiresAt),
    );
    return { transport: "cookie" };
  }

  return { transport: "json" };
};

export const clearAuthTransport = (request: NextRequest, response: NextResponse): void => {
  response.cookies.set(REFRESH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: resolveRefreshCookieSameSite(),
    secure: isSecureCookieRequest(request),
    path: "/",
    maxAge: 0,
  });
};