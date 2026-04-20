import type { Request, Response } from 'express';
import { z } from 'zod';

import type { TokenPair } from './contracts.js';

const WEB_GUEST_USER_ID_PREFIX = 'web-guest-';
const UUID_V4_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isWebGuestUserId = (value: string): boolean => {
  if (value.startsWith(WEB_GUEST_USER_ID_PREFIX)) {
    const suffix = value.slice(WEB_GUEST_USER_ID_PREFIX.length);
    return UUID_V4_LIKE_PATTERN.test(suffix);
  }

  // Backward compatibility for older installs that stored raw UUID guest IDs.
  return UUID_V4_LIKE_PATTERN.test(value);
};

export const authCredentialsSchema = z.object({
  username: z.string().min(3).max(30),
  password: z.string().min(8).max(128),
  deviceId: z.string().min(1).max(128).optional(),
  guestUserId: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .refine((value) => value === undefined || isWebGuestUserId(value), {
      message: 'guestUserId must be a valid web guest identifier',
    }),
});

export const refreshSchema = z.object({
  refreshToken: z.string().optional(),
  deviceId: z.string().min(1).max(128).optional(),
});

export const logoutSchema = z.object({
  refreshToken: z.string().optional(),
});

export const upgradeSessionSchema = z.object({
  userId: z.string().min(1),
  legacySessionToken: z.string().min(1).optional(),
  deviceId: z.string().min(1).max(128).optional(),
});

const REFRESH_COOKIE_NAME = 'ank_refresh_token';

const parseCookies = (request: Request): Readonly<Record<string, string>> => {
  const header = request.header('cookie');
  if (!header) {
    return {};
  }

  return header.split(';').reduce<Record<string, string>>((acc, pair) => {
    const separatorIndex = pair.indexOf('=');
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
  request: Request,
  explicitToken: string | undefined,
): string | null => {
  if (explicitToken) {
    return explicitToken;
  }

  const cookies = parseCookies(request);
  return cookies[REFRESH_COOKIE_NAME] ?? null;
};

const shouldUseCookieTransport = (request: Request): boolean => {
  const requestOrigin = request.header('origin');
  if (requestOrigin) {
    return true;
  }

  const transportHint = request.header('x-client-platform');
  if (transportHint) {
    return transportHint.toLowerCase() === 'web';
  }

  return true;
};

const isSecureCookieRequest = (request: Request): boolean => {
  if (process.env.NODE_ENV === 'production') {
    return true;
  }

  const forwardedProto = request.header('x-forwarded-proto');
  if (forwardedProto && forwardedProto.toLowerCase() === 'https') {
    return true;
  }

  return request.secure;
};

const buildCookieOptions = (request: Request, expiresAt: number) => {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isSecureCookieRequest(request),
    path: '/',
    expires: new Date(expiresAt),
  };
};

export const writeAuthTransport = (
  request: Request,
  response: Response,
  tokenPair: TokenPair,
): Readonly<{ transport: 'cookie' | 'json' }> => {
  if (shouldUseCookieTransport(request)) {
    response.cookie(
      REFRESH_COOKIE_NAME,
      tokenPair.refreshToken,
      buildCookieOptions(request, tokenPair.refreshExpiresAt),
    );
    return { transport: 'cookie' };
  }

  return { transport: 'json' };
};

export const clearAuthTransport = (request: Request, response: Response): void => {
  response.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureCookieRequest(request),
    path: '/',
  });
};
