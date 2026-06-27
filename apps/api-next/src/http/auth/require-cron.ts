import { timingSafeEqual } from "node:crypto";

import { AppError } from "@backend/middleware/error-middleware";

export type CronAuthConfig = Readonly<{
  cronSecret?: string;
}>;

const toCronAuthError = (): AppError => {
  return new AppError({
    code: "auth",
    message: "Invalid cron authorization",
  });
};

const secretsMatch = (provided: string, expected: string): boolean => {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
};

const extractBearerToken = (authorization: string): string | null => {
  const [scheme, token] = authorization.trim().split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
};

const isVercelCronInvocation = (headers: Headers): boolean => {
  return headers.get("x-vercel-cron") === "1";
};

let cronAuthConfigForTests: CronAuthConfig | undefined;

/** Test-only override for cron auth configuration. */
export const setCronAuthConfigForTests = (config: CronAuthConfig): void => {
  cronAuthConfigForTests = config;
};

export const resetCronAuthConfigForTests = (): void => {
  cronAuthConfigForTests = undefined;
};

const resolveCronSecret = (config?: CronAuthConfig): string | undefined => {
  const secret = config?.cronSecret ?? cronAuthConfigForTests?.cronSecret ?? process.env.CRON_SECRET;
  if (!secret || secret.trim().length === 0) {
    return undefined;
  }

  return secret;
};

/**
 * Authorizes maintenance cron routes.
 *
 * Primary: `Authorization: Bearer ${CRON_SECRET}` (see apps/api-next/.env.example).
 * Secondary: `x-vercel-cron: 1` for Vercel Cron invocations when bearer auth is absent.
 */
export const verifyCronAuth = (headers: Headers, config?: CronAuthConfig): void => {
  const cronSecret = resolveCronSecret(config);
  const authorization = headers.get("authorization");

  if (authorization && cronSecret) {
    const token = extractBearerToken(authorization);
    if (token && secretsMatch(token, cronSecret)) {
      return;
    }
  }

  if (isVercelCronInvocation(headers)) {
    return;
  }

  throw toCronAuthError();
};