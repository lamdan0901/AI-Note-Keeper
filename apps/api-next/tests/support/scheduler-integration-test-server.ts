import { createTokenFactory } from "@backend/auth/tokens";
import type { QstashVerifierConfig } from "@backend/reminders/runtime";

import { createScheduledTaskPostHandler } from "../../src/handlers/internal/scheduled-task-post";
import {
  resetAccessMiddlewareDepsForTests,
  setAccessMiddlewareDepsForTests,
  type AccessMiddlewareDeps,
} from "../../src/http/auth/require-access";
import {
  composeServices,
  resetComposedServicesForTests,
  setComposedServicesForTests,
} from "../../src/server/compose-services-impl";
import {
  createInternalRawRoute,
  startNextTestServer,
  type NextTestServer,
} from "./next-test-server";
import {
  authHeaders,
  remindersRouteRegistrations,
  type RemindersTestServer,
} from "./reminders-test-server";
import {
  createSchedulerHarness,
  SCHEDULER_INTEGRATION_USER_ID,
  type SchedulerHarness,
} from "./scheduler-integration-harness";

export const SCHEDULER_VERIFIER_CONFIG: QstashVerifierConfig = {
  currentSigningKey: "current-signing-key",
  nextSigningKey: "next-signing-key",
  callbackUrl: "https://api.example.test/internal/reminders/scheduled-task",
};

export const INTERNAL_SCHEDULED_TASK_PATH = "/internal/reminders/scheduled-task";

export type SchedulerIntegrationTestServer = Readonly<{
  baseUrl: string;
  port: number;
  fetch: (pathname: string, init?: RequestInit) => Promise<Response>;
  harness: SchedulerHarness;
  accessToken: string;
  authUserId: string;
  close: () => Promise<void>;
}>;

export type SchedulerIntegrationTestServerOptions = Readonly<{
  harness?: SchedulerHarness;
  initialNow?: Date;
  accessMiddlewareDeps?: AccessMiddlewareDeps;
  accessToken?: string;
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
 * Starts an in-process api-next server with reminders CRUD routes and the
 * QStash internal callback wired to a fake scheduler harness.
 */
export const startSchedulerIntegrationTestServer = async (
  options: SchedulerIntegrationTestServerOptions = {},
): Promise<SchedulerIntegrationTestServer> => {
  const harness =
    options.harness ??
    createSchedulerHarness(options.initialNow ?? new Date("2026-06-13T09:00:00.000Z"));

  const services = composeServices();
  setComposedServicesForTests({
    ...services,
    remindersService: harness.reminderService,
    reminderScheduledTaskExecutor: harness.scheduledTaskExecutor,
    reminderQstashVerifierConfig: SCHEDULER_VERIFIER_CONFIG,
  });

  setAccessMiddlewareDepsForTests(options.accessMiddlewareDeps);

  const internalHandler = createScheduledTaskPostHandler({
    executor: harness.scheduledTaskExecutor,
    verifierConfig: SCHEDULER_VERIFIER_CONFIG,
    verify: async () => true,
  });

  const accessToken =
    options.accessToken ??
    (await createAccessToken(SCHEDULER_INTEGRATION_USER_ID, SCHEDULER_INTEGRATION_USER_ID));

  const server = await startNextTestServer({
    routes: [
      ...remindersRouteRegistrations,
      createInternalRawRoute("POST", INTERNAL_SCHEDULED_TASK_PATH, internalHandler),
    ],
  });

  const port = Number(new URL(server.baseUrl).port);

  return {
    baseUrl: server.baseUrl,
    port,
    fetch: server.fetch,
    harness,
    accessToken,
    authUserId: SCHEDULER_INTEGRATION_USER_ID,
    close: async () => {
      await server.close();
      resetComposedServicesForTests();
      resetAccessMiddlewareDepsForTests();
    },
  };
};

export const jsonAuthHeaders = (token: string): Headers => {
  const headers = authHeaders(token);
  headers.set("content-type", "application/json");
  return headers;
};

export const internalCallbackHeaders = (): Headers => {
  return new Headers({
    "content-type": "application/json",
    "Upstash-Signature": "signed-jwt",
  });
};

export type { NextTestServer, RemindersTestServer };