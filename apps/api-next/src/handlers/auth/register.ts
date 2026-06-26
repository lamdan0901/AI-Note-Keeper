import type { AuthService } from "@backend/auth/service";

import type { RequestContext } from "@/http/types";

import { buildAuthResponse, toDeviceId, type AuthHandler, type AuthHandlerResult } from "./shared";

type RegisterBody = Readonly<{
  username: string;
  password: string;
  deviceId?: string;
  guestUserId?: string;
}>;

export const createRegisterHandler = (authService: AuthService): AuthHandler => {
  return async (ctx: RequestContext): Promise<AuthHandlerResult> => {
    const body = ctx.body as RegisterBody;
    const session = await authService.register({
      username: body.username,
      password: body.password,
      deviceId: toDeviceId(body.deviceId),
      guestUserId: typeof body.guestUserId === "string" ? body.guestUserId : undefined,
    });

    return {
      status: 201,
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