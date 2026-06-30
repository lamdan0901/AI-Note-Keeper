import type { AuthService } from "@backend/auth/service";

import { resolveRefreshToken } from "@/http/auth/transport";
import type { RequestContext } from "@/http/types";

import {
  buildAuthResponse,
  toAuthError,
  toDeviceId,
  type AuthHandler,
  type AuthHandlerResult,
} from "./shared";

type RefreshBody = Readonly<{
  refreshToken?: string;
  deviceId?: string;
}>;

export const createRefreshHandler = (authService: AuthService): AuthHandler => {
  return async (ctx: RequestContext): Promise<AuthHandlerResult> => {
    const body = ctx.body as RefreshBody;
    const refreshToken = resolveRefreshToken(ctx.request, body.refreshToken);

    if (!refreshToken) {
      throw toAuthError("Refresh token is required");
    }

    const session = await authService.refresh({
      refreshToken,
      deviceId: toDeviceId(body.deviceId),
    });

    return {
      status: 200,
      body: buildAuthResponse({
        userId: session.userId,
        username: session.username,
        accessToken: session.tokens.accessToken,
        refreshToken: session.tokens.refreshToken,
        transport: "json",
      }),
      tokens: session.tokens,
    };
  };
};