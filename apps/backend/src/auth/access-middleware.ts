import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AppError } from '../middleware/error-middleware.js';
import { createTokenFactory } from './tokens.js';

export type AuthenticatedRequest = Request & {
  authUser: Readonly<{
    userId: string;
    username: string;
  }>;
};

type AccessMiddlewareDeps = Readonly<{
  tokenFactory?: Pick<ReturnType<typeof createTokenFactory>, 'verifyAccessToken'>;
}>;

const toAuthError = (message: string): AppError => {
  return new AppError({ code: 'auth', message });
};

const extractBearerToken = (request: Request): string => {
  const authorization = request.header('authorization');
  if (!authorization) {
    throw toAuthError('Access token is required');
  }

  const [scheme, token] = authorization.trim().split(/\s+/, 2);
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw toAuthError('Bearer access token is required');
  }

  return token;
};

export const requireAccessUser = (deps: AccessMiddlewareDeps = {}): RequestHandler => {
  const tokenFactory = deps.tokenFactory ?? createTokenFactory();

  return (request: Request, _response: Response, next: NextFunction): void => {
    const token = (() => {
      try {
        return extractBearerToken(request);
      } catch (error) {
        next(error);
        return null;
      }
    })();

    if (!token) {
      return;
    }

    void tokenFactory
      .verifyAccessToken(token)
      .then((payload) => {
        (request as AuthenticatedRequest).authUser = {
          userId: payload.userId,
          username: payload.username,
        };
        next();
      })
      .catch(() => {
        next(toAuthError('Invalid access token'));
      });
  };
};
