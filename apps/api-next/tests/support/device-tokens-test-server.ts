import { createTokenFactory } from "@backend/auth/tokens";
import type { DeviceTokensService } from "@backend/device-tokens/service";

import { DELETE as deleteDeviceToken } from "../../app/api/device-tokens/[deviceId]/route";
import { POST as upsertDeviceToken } from "../../app/api/device-tokens/route";
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
  createDeviceTokensServiceDouble,
  type DeviceTokensServiceDouble,
} from "./device-tokens-service-double";
import {
  startNextTestServer,
  type NextTestServer,
  type RouteRegistration,
} from "./next-test-server";

export const DEFAULT_AUTH_USER_ID = "device-tokens-harness-user-1";
export const DEFAULT_AUTH_USERNAME = "alice";

export const deviceTokensRouteRegistrations: ReadonlyArray<RouteRegistration> = [
  { method: "POST", pathname: "/api/device-tokens", handler: upsertDeviceToken },
  {
    method: "DELETE",
    pathname: "/api/device-tokens/:deviceId",
    pattern: "/api/device-tokens/:deviceId",
    handler: deleteDeviceToken,
  },
];

export const authHeaders = (token: string): Headers => {
  return new Headers({
    authorization: `Bearer ${token}`,
  });
};

export const guestHeaders = (guestUserId: string, platform: "web" | "mobile"): Headers => {
  return new Headers({
    "x-client-platform": platform,
    "x-guest-user-id": guestUserId,
  });
};

export const jsonAuthHeaders = (token: string): Headers => {
  const headers = authHeaders(token);
  headers.set("content-type", "application/json");
  return headers;
};

export const jsonGuestHeaders = (
  guestUserId: string,
  platform: "web" | "mobile",
): Headers => {
  const headers = guestHeaders(guestUserId, platform);
  headers.set("content-type", "application/json");
  return headers;
};

export const mockResolveWebGuestUser = async (
  guestUserId: string,
): Promise<Readonly<{ userId: string; username: string }>> => {
  return {
    userId: guestUserId,
    username: `__web_guest_user__${guestUserId}`,
  };
};

export type DeviceTokensTestServerOptions = Readonly<{
  deviceTokensService?: DeviceTokensService | DeviceTokensServiceDouble;
  authUserId?: string;
  authUsername?: string;
  accessToken?: string;
  accessMiddlewareDeps?: AccessMiddlewareDeps;
  routes?: ReadonlyArray<RouteRegistration>;
}>;

export type DeviceTokensTestServer = Readonly<{
  baseUrl: string;
  port: number;
  fetch: (pathname: string, init?: RequestInit) => Promise<Response>;
  deviceTokensService: DeviceTokensServiceDouble;
  accessToken: string;
  authUserId: string;
  close: () => Promise<void>;
}>;

const isDeviceTokensServiceDouble = (
  input: DeviceTokensService | DeviceTokensServiceDouble,
): input is DeviceTokensServiceDouble => {
  return "tokens" in input;
};

const resolveDeviceTokensServiceInput = (
  input: DeviceTokensService | DeviceTokensServiceDouble | undefined,
): DeviceTokensServiceDouble => {
  if (!input) {
    return createDeviceTokensServiceDouble();
  }

  if (isDeviceTokensServiceDouble(input)) {
    return input;
  }

  return createDeviceTokensServiceDouble();
};

const createAccessToken = async (userId: string, username: string): Promise<string> => {
  const tokenFactory = createTokenFactory();
  const tokens = await tokenFactory.issueTokenPair({ userId, username });
  return tokens.accessToken;
};

/**
 * Starts an in-process api-next test server with Phase 4 device-tokens routes wired
 * to an injectable DeviceTokensService double.
 *
 * Guest flows use a mocked resolveWebGuestUser — no database required.
 * Uses an ephemeral localhost port — never binds :3001.
 */
export const startDeviceTokensTestServer = async (
  options: DeviceTokensTestServerOptions = {},
): Promise<DeviceTokensTestServer> => {
  const authUserId = options.authUserId ?? DEFAULT_AUTH_USER_ID;
  const authUsername = options.authUsername ?? DEFAULT_AUTH_USERNAME;
  const deviceTokensService = resolveDeviceTokensServiceInput(options.deviceTokensService);

  const services = composeServices();
  setComposedServicesForTests({
    ...services,
    deviceTokensService,
  });

  setAccessMiddlewareDepsForTests({
    resolveWebGuestUser: mockResolveWebGuestUser,
    ...options.accessMiddlewareDeps,
  });

  const accessToken =
    options.accessToken ?? (await createAccessToken(authUserId, authUsername));

  const server = await startNextTestServer({
    routes: options.routes ?? deviceTokensRouteRegistrations,
  });

  const port = Number(new URL(server.baseUrl).port);

  return {
    baseUrl: server.baseUrl,
    port,
    fetch: server.fetch,
    deviceTokensService,
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