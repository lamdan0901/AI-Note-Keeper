import type { AuthService } from "@backend/auth/service";

import type { RequestContext } from "@/http/types";

import { buildAuthResponse, toDeviceId, type AuthHandler, type AuthHandlerResult } from "./shared";

type UpgradeSessionBody = Readonly<{
  userId: string;
  legacySessionToken?: string;
  deviceId?: string;
}>;

export const createUpgradeSessionHandler = (authService: AuthService): AuthHandler => {
  return async (ctx: RequestContext): Promise<AuthHandlerResult> => {
    const body = ctx.body as UpgradeSessionBody;
    const session = await authService.upgradeSession({
      userId: body.userId,
      legacySessionToken: body.legacySessionToken,
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