import { createTokenFactory } from "@backend/auth/tokens";
import type { MergeService } from "@backend/merge/service";

import { POST as mergeApplyPost } from "../../app/api/merge/apply/route";
import { POST as mergePreflightPost } from "../../app/api/merge/preflight/route";
import {
  composeServices,
  resetComposedServicesForTests,
  setComposedServicesForTests,
} from "../../src/server/compose-services";
import { createMergeServiceDouble } from "./merge-service-double";
import {
  startNextTestServer,
  type NextTestServer,
  type RouteRegistration,
} from "./next-test-server";

export const DEFAULT_AUTH_USER_ID = "source-user";
export const DEFAULT_AUTH_USERNAME = "alice";

export const mergeRouteRegistrations: ReadonlyArray<RouteRegistration> = [
  { method: "POST", pathname: "/api/merge/preflight", handler: mergePreflightPost },
  { method: "POST", pathname: "/api/merge/apply", handler: mergeApplyPost },
];

export const authHeaders = (token: string): Headers => {
  return new Headers({
    authorization: `Bearer ${token}`,
  });
};

export const jsonAuthHeaders = (token: string): Headers => {
  const headers = authHeaders(token);
  headers.set("content-type", "application/json");
  return headers;
};

export type MergeTestServerOptions = Readonly<{
  mergeService?: MergeService;
  authUserId?: string;
  authUsername?: string;
  accessToken?: string;
  routes?: ReadonlyArray<RouteRegistration>;
}>;

export type MergeTestServer = Readonly<{
  baseUrl: string;
  port: number;
  fetch: (pathname: string, init?: RequestInit) => Promise<Response>;
  mergeService: MergeService;
  accessToken: string;
  authUserId: string;
  close: () => Promise<void>;
}>;

const createAccessToken = async (userId: string, username: string): Promise<string> => {
  const tokenFactory = createTokenFactory();
  const tokens = await tokenFactory.issueTokenPair({ userId, username });
  return tokens.accessToken;
};

/**
 * Starts an in-process api-next test server with Phase 4 merge routes wired
 * to an injectable MergeService double.
 *
 * Uses an ephemeral localhost port — never binds :3001.
 */
export const startMergeTestServer = async (
  options: MergeTestServerOptions = {},
): Promise<MergeTestServer> => {
  const authUserId = options.authUserId ?? DEFAULT_AUTH_USER_ID;
  const authUsername = options.authUsername ?? DEFAULT_AUTH_USERNAME;
  const mergeService = options.mergeService ?? createMergeServiceDouble();

  const services = composeServices();
  setComposedServicesForTests({
    ...services,
    mergeService,
  });

  const accessToken =
    options.accessToken ?? (await createAccessToken(authUserId, authUsername));

  const server = await startNextTestServer({
    routes: options.routes ?? mergeRouteRegistrations,
  });

  const port = Number(new URL(server.baseUrl).port);

  return {
    baseUrl: server.baseUrl,
    port,
    fetch: server.fetch,
    mergeService,
    accessToken,
    authUserId,
    close: async () => {
      await server.close();
      resetComposedServicesForTests();
    },
  };
};

export type { NextTestServer };