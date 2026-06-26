import type { AuthService } from "@backend/auth/service";

import { POST as loginPost } from "../../app/api/auth/login/route";
import { POST as logoutPost } from "../../app/api/auth/logout/route";
import { POST as refreshPost } from "../../app/api/auth/refresh/route";
import { POST as registerPost } from "../../app/api/auth/register/route";
import { POST as upgradeSessionPost } from "../../app/api/auth/upgrade-session/route";
import { resetAuthServiceForTests, setAuthServiceForTests } from "../../src/server/auth-service";
import {
  createAuthServiceDouble,
  type AuthServiceCall,
  type AuthServiceDouble,
} from "./auth-service-double";
import {
  startNextTestServer,
  type NextTestServer,
  type RouteRegistration,
} from "./next-test-server";

export const authRouteRegistrations: ReadonlyArray<RouteRegistration> = [
  { method: "POST", pathname: "/api/auth/register", handler: registerPost },
  { method: "POST", pathname: "/api/auth/login", handler: loginPost },
  { method: "POST", pathname: "/api/auth/refresh", handler: refreshPost },
  { method: "POST", pathname: "/api/auth/logout", handler: logoutPost },
  { method: "POST", pathname: "/api/auth/upgrade-session", handler: upgradeSessionPost },
];

export type AuthRequestHeaders = Readonly<{
  clientPlatform?: "web" | "mobile";
  origin?: string;
  forwardedProto?: "http" | "https";
  cookie?: string;
  forwardedFor?: string;
}>;

export const buildAuthRequestInit = (
  body: unknown,
  headers: AuthRequestHeaders = {},
): RequestInit => {
  const requestHeaders = new Headers({
    "content-type": "application/json",
  });

  if (headers.clientPlatform) {
    requestHeaders.set("x-client-platform", headers.clientPlatform);
  }

  if (headers.origin) {
    requestHeaders.set("origin", headers.origin);
  }

  if (headers.forwardedProto) {
    requestHeaders.set("x-forwarded-proto", headers.forwardedProto);
  }

  if (headers.cookie) {
    requestHeaders.set("cookie", headers.cookie);
  }

  if (headers.forwardedFor) {
    requestHeaders.set("x-forwarded-for", headers.forwardedFor);
  }

  return {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(body),
  };
};

export type AuthTestServer = Readonly<{
  baseUrl: string;
  port: number;
  fetch: (pathname: string, init?: RequestInit) => Promise<Response>;
  authService: AuthService;
  calls: ReadonlyArray<AuthServiceCall>;
  close: () => Promise<void>;
}>;

const resolveAuthServiceInput = (
  input: AuthService | AuthServiceDouble,
): Readonly<{ authService: AuthService; calls: ReadonlyArray<AuthServiceCall> }> => {
  if ("authService" in input && "calls" in input) {
    return {
      authService: input.authService,
      calls: input.calls,
    };
  }

  return {
    authService: input,
    calls: [],
  };
};

/**
 * Starts an in-process api-next test server with all Phase 1 auth routes wired
 * to an injectable AuthService (or AuthServiceDouble from createAuthServiceDouble).
 *
 * Uses an ephemeral localhost port — never binds :3001.
 */
export const startAuthTestServer = async (
  authServiceInput: AuthService | AuthServiceDouble = createAuthServiceDouble(),
): Promise<AuthTestServer> => {
  const { authService, calls } = resolveAuthServiceInput(authServiceInput);
  setAuthServiceForTests(authService);

  const server = await startNextTestServer({
    routes: authRouteRegistrations,
  });

  const port = Number(new URL(server.baseUrl).port);

  return {
    baseUrl: server.baseUrl,
    port,
    fetch: server.fetch,
    authService,
    calls,
    close: async () => {
      await server.close();
      resetAuthServiceForTests();
    },
  };
};

export type { NextTestServer };