import type { AuthService } from "@backend/auth/service";

export type AuthServiceCall = Readonly<{
  method: string;
  args: Record<string, unknown>;
}>;

export type AuthServiceDouble = Readonly<{
  authService: AuthService;
  calls: Array<AuthServiceCall>;
}>;

export const createAuthServiceDouble = (): AuthServiceDouble => {
  const calls: Array<AuthServiceCall> = [];

  const authService: AuthService = {
    register: async (input) => {
      calls.push({ method: "register", args: input as Record<string, unknown> });
      return {
        userId: "u-register",
        username: input.username,
        tokens: {
          accessToken: "access-register",
          refreshToken: "refresh-register",
          accessExpiresAt: Date.now() + 60_000,
          refreshExpiresAt: Date.now() + 120_000,
        },
      };
    },
    login: async (input) => {
      calls.push({ method: "login", args: input as Record<string, unknown> });
      return {
        userId: "u-login",
        username: input.username,
        tokens: {
          accessToken: "access-login",
          refreshToken: "refresh-login",
          accessExpiresAt: Date.now() + 60_000,
          refreshExpiresAt: Date.now() + 120_000,
        },
      };
    },
    upgradeSession: async (input) => {
      calls.push({ method: "upgradeSession", args: input as Record<string, unknown> });
      return {
        userId: input.userId,
        username: "legacy-user",
        tokens: {
          accessToken: "access-upgrade",
          refreshToken: "refresh-upgrade",
          accessExpiresAt: Date.now() + 60_000,
          refreshExpiresAt: Date.now() + 120_000,
        },
      };
    },
    refresh: async (input) => {
      calls.push({ method: "refresh", args: input as Record<string, unknown> });
      return {
        userId: "u-refresh",
        username: "alice",
        tokens: {
          accessToken: "access-refresh",
          refreshToken: "refresh-refresh",
          accessExpiresAt: Date.now() + 60_000,
          refreshExpiresAt: Date.now() + 120_000,
        },
      };
    },
    logout: async (input) => {
      calls.push({ method: "logout", args: input as Record<string, unknown> });
    },
  };

  return { authService, calls };
};