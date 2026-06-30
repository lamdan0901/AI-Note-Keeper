import type { TokenPair } from "@backend/auth/contracts";
import { AppError } from "@backend/middleware/error-middleware";

import type { RequestContext } from "@/http/types";

export type AuthHandlerResult = Readonly<{
  status: number;
  body: Record<string, unknown>;
  tokens?: TokenPair;
  clearTransport?: boolean;
}>;

export type AuthHandler = (ctx: RequestContext) => Promise<AuthHandlerResult>;

export {
  authCredentialsSchema,
  logoutSchema,
  refreshSchema,
  upgradeSessionSchema,
} from "@backend/auth/http.js";

export const toAuthError = (message: string): AppError => {
  return new AppError({ code: "auth", message });
};

export const toDeviceId = (value: unknown): string | null => {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
};

export const buildAuthResponse = (
  input: Readonly<{
    userId: string;
    username: string;
    accessToken: string;
    transport: "cookie" | "json";
    refreshToken: string;
  }>,
): Record<string, unknown> => {
  return {
    userId: input.userId,
    username: input.username,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    transport: input.transport,
  };
};