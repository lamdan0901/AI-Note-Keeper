import { createTokenFactory } from "@backend/auth/tokens";
import type { ExpensesRepository } from "@backend/expenses/repository";
import type { ExpensesService } from "@backend/expenses/service";

import { GET as getSettingsGet, PUT as putSettingsPut } from "../../app/api/expenses/settings/route";
import { GET as listPeriodsGet, POST as createPeriodPost } from "../../app/api/expenses/periods/route";
import { GET as getCurrentPeriodGet } from "../../app/api/expenses/periods/current/route";
import { GET as findPeriodByMonthGet } from "../../app/api/expenses/periods/by-month/route";
import { GET as getPeriodGet } from "../../app/api/expenses/periods/[periodId]/route";
import { GET as listTrashRowsGet } from "../../app/api/expenses/periods/[periodId]/trash/route";
import { PATCH as updatePeriodSchemaPatch } from "../../app/api/expenses/periods/[periodId]/schema/route";
import { POST as createRowPost } from "../../app/api/expenses/periods/[periodId]/rows/route";
import {
  PATCH as updateRowPatch,
  DELETE as deleteRowDelete,
} from "../../app/api/expenses/rows/[rowId]/route";
import { POST as restoreRowPost } from "../../app/api/expenses/rows/[rowId]/restore/route";
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
  createExpensesServiceDouble,
  createInMemoryExpensesRepository,
  type InMemoryExpensesRepositoryInitial,
} from "./expenses-service-double";
import {
  startNextTestServer,
  type NextTestServer,
  type RouteRegistration,
} from "./next-test-server";

export const DEFAULT_AUTH_USER_ID = "expenses-harness-user-1";
export const DEFAULT_AUTH_USERNAME = "alice";
export const DEFAULT_GUEST_USER_ID = "web-guest-123e4567-e89b-12d3-a456-426614174000";

export const expensesRouteRegistrations: ReadonlyArray<RouteRegistration> = [
  { method: "GET", pathname: "/api/expenses/settings", handler: getSettingsGet },
  { method: "PUT", pathname: "/api/expenses/settings", handler: putSettingsPut },
  { method: "GET", pathname: "/api/expenses/periods", handler: listPeriodsGet },
  { method: "POST", pathname: "/api/expenses/periods", handler: createPeriodPost },
  { method: "GET", pathname: "/api/expenses/periods/current", handler: getCurrentPeriodGet },
  { method: "GET", pathname: "/api/expenses/periods/by-month", handler: findPeriodByMonthGet },
  {
    method: "GET",
    pathname: "/api/expenses/periods/:periodId",
    pattern: "/api/expenses/periods/:periodId",
    handler: getPeriodGet,
  },
  {
    method: "GET",
    pathname: "/api/expenses/periods/:periodId/trash",
    pattern: "/api/expenses/periods/:periodId/trash",
    handler: listTrashRowsGet,
  },
  {
    method: "PATCH",
    pathname: "/api/expenses/periods/:periodId/schema",
    pattern: "/api/expenses/periods/:periodId/schema",
    handler: updatePeriodSchemaPatch,
  },
  {
    method: "POST",
    pathname: "/api/expenses/periods/:periodId/rows",
    pattern: "/api/expenses/periods/:periodId/rows",
    handler: createRowPost,
  },
  {
    method: "PATCH",
    pathname: "/api/expenses/rows/:rowId",
    pattern: "/api/expenses/rows/:rowId",
    handler: updateRowPatch,
  },
  {
    method: "DELETE",
    pathname: "/api/expenses/rows/:rowId",
    pattern: "/api/expenses/rows/:rowId",
    handler: deleteRowDelete,
  },
  {
    method: "POST",
    pathname: "/api/expenses/rows/:rowId/restore",
    pattern: "/api/expenses/rows/:rowId/restore",
    handler: restoreRowPost,
  },
];

export const authHeaders = (token: string): Headers => {
  return new Headers({
    authorization: `Bearer ${token}`,
  });
};

export const guestHeaders = (guestUserId: string, platform: "web" | "mobile" = "web"): Headers => {
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

export const mockResolveWebGuestUser = async (
  guestUserId: string,
): Promise<Readonly<{ userId: string; username: string }>> => {
  return {
    userId: guestUserId,
    username: `__web_guest_user__${guestUserId}`,
  };
};

export type ExpensesTestServerOptions = Readonly<{
  expensesService?: ExpensesService;
  repository?: ExpensesRepository;
  repositoryInitial?: InMemoryExpensesRepositoryInitial;
  authUserId?: string;
  authUsername?: string;
  accessToken?: string;
  accessMiddlewareDeps?: AccessMiddlewareDeps;
  routes?: ReadonlyArray<RouteRegistration>;
}>;

export type ExpensesTestServer = Readonly<{
  baseUrl: string;
  port: number;
  fetch: (pathname: string, init?: RequestInit) => Promise<Response>;
  expensesService: ExpensesService;
  repository: ExpensesRepository;
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
 * Starts an in-process api-next test server with Phase 4 expenses routes wired
 * to an injectable in-memory ExpensesRepository double.
 *
 * Guest flows use a mocked resolveWebGuestUser — no database required.
 * Uses an ephemeral localhost port — never binds :3001.
 */
export const startExpensesTestServer = async (
  options: ExpensesTestServerOptions = {},
): Promise<ExpensesTestServer> => {
  const authUserId = options.authUserId ?? DEFAULT_AUTH_USER_ID;
  const authUsername = options.authUsername ?? DEFAULT_AUTH_USERNAME;
  const repository =
    options.repository ??
    createInMemoryExpensesRepository(options.repositoryInitial ?? {});
  const expensesService =
    options.expensesService ?? createExpensesServiceDouble({}, repository);

  const services = composeServices();
  setComposedServicesForTests({
    ...services,
    expensesService,
  });

  setAccessMiddlewareDepsForTests({
    resolveWebGuestUser: mockResolveWebGuestUser,
    ...options.accessMiddlewareDeps,
  });

  const accessToken =
    options.accessToken ?? (await createAccessToken(authUserId, authUsername));

  const server = await startNextTestServer({
    routes: options.routes ?? expensesRouteRegistrations,
  });

  const port = Number(new URL(server.baseUrl).port);

  return {
    baseUrl: server.baseUrl,
    port,
    fetch: server.fetch,
    expensesService,
    repository,
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