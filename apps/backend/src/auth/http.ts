import type { Request, Response } from 'express';
import { z } from 'zod';

import type { TokenPair } from './contracts.js';

export const authCredentialsSchema = z.object({
  username: z.string().min(3).max(30),
  password: z.string().min(8).max(128),
  deviceId: z.string().min(1).max(128).optional(),
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
  const transportHint = request.header('x-client-platform');
  if (transportHint) {
    return transportHint.toLowerCase() === 'web';
  }

  return true;
};

const buildCookieOptions = (expiresAt: number) => {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: false,
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
    response.cookie(REFRESH_COOKIE_NAME, tokenPair.refreshToken, buildCookieOptions(tokenPair.refreshExpiresAt));
    return { transport: 'cookie' };
  }

  return { transport: 'json' };
};

export const clearAuthTransport = (response: Response): void => {
  response.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
  });
};
