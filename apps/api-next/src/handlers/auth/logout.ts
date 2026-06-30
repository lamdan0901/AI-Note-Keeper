import type { AuthService } from "@backend/auth/service";

import { resolveRefreshToken } from "@/http/auth/transport";
import type { RequestContext } from "@/http/types";

import { toAuthError, type AuthHandler, type AuthHandlerResult } from "./shared";

type LogoutBody = Readonly<{
  refreshToken?: string;
}>;

export const createLogoutHandler = (authService: AuthService): AuthHandler => {
  return async (ctx: RequestContext): Promise<AuthHandlerResult> => {
    const body = ctx.body as LogoutBody;
    const refreshToken = resolveRefreshToken(ctx.request, body.refreshToken);

    if (!refreshToken) {
      throw toAuthError("Refresh token is required");
    }

    await authService.logout({ refreshToken });

    return {
      status: 204,
      body: {},
      clearTransport: true,
    };
  };
};