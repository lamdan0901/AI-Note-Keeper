import type { AuthService } from "@backend/auth/service";

import type { RequestContext } from "@/http/types";

import { buildAuthResponse, toDeviceId, type AuthHandler, type AuthHandlerResult } from "./shared";

type LoginBody = Readonly<{
  username: string;
  password: string;
  deviceId?: string;
}>;

export const createLoginHandler = (authService: AuthService): AuthHandler => {
  return async (ctx: RequestContext): Promise<AuthHandlerResult> => {
    const body = ctx.body as LoginBody;
    const session = await authService.login({
      username: body.username,
      password: body.password,
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