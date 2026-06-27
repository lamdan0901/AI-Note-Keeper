import { createTokenFactory } from "@backend/auth/tokens";

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
  createPhase4RemindersParityHarness,
  type Phase4RemindersParityHarness,
} from "./phase4-reminders-parity-harness";
import { startNextTestServer } from "./next-test-server";
import { authHeaders, remindersRouteRegistrations } from "./reminders-test-server";

export type Phase4RemindersParityTestServer = Readonly<{
  baseUrl: string;
  port: number;
  fetch: (pathname: string, init?: RequestInit) => Promise<Response>;
  harness: Phase4RemindersParityHarness;
  close: () => Promise<void>;
}>;

export type Phase4RemindersParityTestServerOptions = Readonly<{
  harness?: Phase4RemindersParityHarness;
  accessMiddlewareDeps?: AccessMiddlewareDeps;
}>;

export const createAccessToken = async (userId: string): Promise<string> => {
  const tokenFactory = createTokenFactory();
  const pair = await tokenFactory.issueTokenPair({ userId, username: userId });
  return pair.accessToken;
};

export const jsonAuthHeaders = (token: string): Headers => {
  const headers = authHeaders(token);
  headers.set("content-type", "application/json");
  return headers;
};

/**
 * Starts an in-process api-next server with reminders routes wired to the
 * phase-4 parity harness (real RemindersService + in-memory repository).
 */
export const startPhase4RemindersParityTestServer = async (
  options: Phase4RemindersParityTestServerOptions = {},
): Promise<Phase4RemindersParityTestServer> => {
  const harness = options.harness ?? createPhase4RemindersParityHarness();

  const services = composeServices();
  setComposedServicesForTests({
    ...services,
    remindersService: harness.remindersService,
  });

  setAccessMiddlewareDepsForTests(options.accessMiddlewareDeps);

  const server = await startNextTestServer({
    routes: remindersRouteRegistrations,
  });

  const port = Number(new URL(server.baseUrl).port);

  return {
    baseUrl: server.baseUrl,
    port,
    fetch: server.fetch,
    harness,
    close: async () => {
      await server.close();
      resetComposedServicesForTests();
      resetAccessMiddlewareDepsForTests();
    },
  };
};