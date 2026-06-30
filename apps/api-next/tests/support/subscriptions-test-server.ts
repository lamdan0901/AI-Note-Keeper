import { createTokenFactory } from "@backend/auth/tokens";
import type { SubscriptionsService } from "@backend/subscriptions/service";

import { PATCH as updateSubscriptionPatch, DELETE as trashSubscriptionDelete } from "../../app/api/subscriptions/[subscriptionId]/route";
import { POST as restoreSubscriptionPost } from "../../app/api/subscriptions/[subscriptionId]/restore/route";
import { DELETE as permanentDeleteSubscription } from "../../app/api/subscriptions/[subscriptionId]/permanent/route";
import { GET as listSubscriptionsGet, POST as createSubscriptionPost } from "../../app/api/subscriptions/route";
import { GET as listTrashedSubscriptionsGet } from "../../app/api/subscriptions/trash/route";
import { DELETE as emptyTrashDelete } from "../../app/api/subscriptions/trash/empty/route";
import {
  resetAccessMiddlewareDepsForTests,
  setAccessMiddlewareDepsForTests,
  type AccessMiddlewareDeps,
} from "../../src/http/auth/require-access";
import {
  composeServices,
  resetComposedServicesForTests,
  setComposedServicesForTests,
} from "../../src/server/compose-services";
import {
  startNextTestServer,
  type NextTestServer,
  type RouteRegistration,
} from "./next-test-server";
import {
  createSubscriptionsServiceDouble,
  type NowRef,
} from "./subscriptions-service-double";

export const DEFAULT_AUTH_USER_ID = "subscriptions-harness-user-1";
export const DEFAULT_AUTH_USERNAME = "alice";

export const subscriptionsRouteRegistrations: ReadonlyArray<RouteRegistration> = [
  { method: "GET", pathname: "/api/subscriptions", handler: listSubscriptionsGet },
  { method: "POST", pathname: "/api/subscriptions", handler: createSubscriptionPost },
  { method: "GET", pathname: "/api/subscriptions/trash", handler: listTrashedSubscriptionsGet },
  { method: "DELETE", pathname: "/api/subscriptions/trash/empty", handler: emptyTrashDelete },
  {
    method: "PATCH",
    pathname: "/api/subscriptions/:subscriptionId",
    pattern: "/api/subscriptions/:subscriptionId",
    handler: updateSubscriptionPatch,
  },
  {
    method: "DELETE",
    pathname: "/api/subscriptions/:subscriptionId",
    pattern: "/api/subscriptions/:subscriptionId",
    handler: trashSubscriptionDelete,
  },
  {
    method: "POST",
    pathname: "/api/subscriptions/:subscriptionId/restore",
    pattern: "/api/subscriptions/:subscriptionId/restore",
    handler: restoreSubscriptionPost,
  },
  {
    method: "DELETE",
    pathname: "/api/subscriptions/:subscriptionId/permanent",
    pattern: "/api/subscriptions/:subscriptionId/permanent",
    handler: permanentDeleteSubscription,
  },
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

export type SubscriptionsTestServerOptions = Readonly<{
  subscriptionsService?: SubscriptionsService;
  nowRef?: NowRef;
  authUserId?: string;
  authUsername?: string;
  accessToken?: string;
  accessMiddlewareDeps?: AccessMiddlewareDeps;
  routes?: ReadonlyArray<RouteRegistration>;
}>;

export type SubscriptionsTestServer = Readonly<{
  baseUrl: string;
  port: number;
  fetch: (pathname: string, init?: RequestInit) => Promise<Response>;
  subscriptionsService: SubscriptionsService;
  accessToken: string;
  authUserId: string;
  close: () => Promise<void>;
}>;

const createAccessToken = async (
  userId: string,
  username: string,
): Promise<string> => {
  const tokenFactory = createTokenFactory();
  const tokens = await tokenFactory.issueTokenPair({ userId, username });
  return tokens.accessToken;
};

/**
 * Starts an in-process api-next test server with Phase 2 subscriptions routes wired
 * to an injectable SubscriptionsService double.
 *
 * Uses an ephemeral localhost port — never binds :3001.
 */
export const startSubscriptionsTestServer = async (
  options: SubscriptionsTestServerOptions = {},
): Promise<SubscriptionsTestServer> => {
  const authUserId = options.authUserId ?? DEFAULT_AUTH_USER_ID;
  const authUsername = options.authUsername ?? DEFAULT_AUTH_USERNAME;
  const nowRef = options.nowRef ?? { nowMs: () => Date.now() };
  const subscriptionsService =
    options.subscriptionsService ?? createSubscriptionsServiceDouble(nowRef);

  const services = composeServices();
  setComposedServicesForTests({
    ...services,
    subscriptionsService,
  });

  setAccessMiddlewareDepsForTests(options.accessMiddlewareDeps);

  const accessToken =
    options.accessToken ?? (await createAccessToken(authUserId, authUsername));

  const server = await startNextTestServer({
    routes: options.routes ?? subscriptionsRouteRegistrations,
  });

  const port = Number(new URL(server.baseUrl).port);

  return {
    baseUrl: server.baseUrl,
    port,
    fetch: server.fetch,
    subscriptionsService,
    accessToken,
    authUserId,
    close: async () => {
      await server.close();
      resetComposedServicesForTests();
      resetAccessMiddlewareDepsForTests();
    },
  };
};

export type { NextTestServer };