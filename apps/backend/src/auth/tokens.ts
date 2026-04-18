import { createHash, randomUUID } from 'node:crypto';

import { SignJWT, jwtVerify, errors as joseErrors, type JWTPayload } from 'jose';

import { readAuthConfig, type AuthConfig } from '../config.js';
import type { AccessTokenPayload, RefreshTokenPayload, TokenPair } from './contracts.js';

const encoder = new TextEncoder();

type TokenFactory = Readonly<{
  issueTokenPair: (payload: Readonly<{ userId: string; username: string }>) => Promise<TokenPair>;
  verifyAccessToken: (token: string) => Promise<AccessTokenPayload>;
  verifyRefreshToken: (token: string) => Promise<RefreshTokenPayload>;
  hashRefreshToken: (token: string) => string;
}>;

type JwtPayloadBase = Readonly<{
  userId: string;
  sessionId: string;
}>;

const parsePayload = <Payload extends JwtPayloadBase>(
  payload: JWTPayload,
  tokenType: 'access' | 'refresh',
): Payload => {
  if (payload.type !== tokenType) {
    throw new Error(`Unexpected token type: ${String(payload.type)}`);
  }

  if (typeof payload.userId !== 'string' || typeof payload.sessionId !== 'string') {
    throw new Error('Token payload is missing user identity claims');
  }

  return payload as unknown as Payload;
};

const createSignedToken = async (
  payload: Record<string, unknown>,
  config: AuthConfig,
  secret: string,
  ttlSeconds: number,
): Promise<string> => {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(encoder.encode(secret));
};

export const createTokenFactory = (config: AuthConfig = readAuthConfig()): TokenFactory => {
  return {
    issueTokenPair: async ({ userId, username }) => {
      const sessionId = randomUUID();
      const tokenId = randomUUID();
      const now = Date.now();

      const accessTokenPayload: AccessTokenPayload = {
        type: 'access',
        userId,
        username,
        sessionId,
      };

      const refreshTokenPayload: RefreshTokenPayload = {
        type: 'refresh',
        userId,
        sessionId,
        tokenId,
      };

      const accessToken = await createSignedToken(
        accessTokenPayload as unknown as Record<string, unknown>,
        config,
        config.JWT_ACCESS_SECRET,
        config.JWT_ACCESS_TTL_SECONDS,
      );

      const refreshToken = await createSignedToken(
        refreshTokenPayload as unknown as Record<string, unknown>,
        config,
        config.JWT_REFRESH_SECRET,
        config.JWT_REFRESH_TTL_SECONDS,
      );

      return {
        accessToken,
        refreshToken,
        accessExpiresAt: now + config.JWT_ACCESS_TTL_SECONDS * 1000,
        refreshExpiresAt: now + config.JWT_REFRESH_TTL_SECONDS * 1000,
      };
    },

    verifyAccessToken: async (token: string) => {
      try {
        const verified = await jwtVerify(token, encoder.encode(config.JWT_ACCESS_SECRET), {
          issuer: config.JWT_ISSUER,
          audience: config.JWT_AUDIENCE,
        });

        if (typeof verified.payload.username !== 'string') {
          throw new Error('Access token is missing username claim');
        }

        return parsePayload<AccessTokenPayload>(verified.payload, 'access');
      } catch (error) {
        if (error instanceof joseErrors.JOSEError) {
          throw new Error(`Access token verification failed: ${error.code}`);
        }

        throw error;
      }
    },

    verifyRefreshToken: async (token: string) => {
      try {
        const verified = await jwtVerify(token, encoder.encode(config.JWT_REFRESH_SECRET), {
          issuer: config.JWT_ISSUER,
          audience: config.JWT_AUDIENCE,
        });

        if (typeof verified.payload.tokenId !== 'string') {
          throw new Error('Refresh token is missing tokenId claim');
        }

        return parsePayload<RefreshTokenPayload>(verified.payload, 'refresh');
      } catch (error) {
        if (error instanceof joseErrors.JOSEError) {
          throw new Error(`Refresh token verification failed: ${error.code}`);
        }

        throw error;
      }
    },

    hashRefreshToken: (token: string) => {
      return createHash('sha256').update(token).digest('hex');
    },
  };
};
