import { createTokenFactory } from "@backend/auth/tokens";
import type { RemindersService } from "@backend/reminders/service";

import {
  GET as listRemindersGet,
  POST as createReminderPost,
} from "../../app/api/reminders/route";
import { POST as ackReminderPost } from "../../app/api/reminders/[reminderId]/ack/route";
import {
  DELETE as deleteReminderDelete,
  GET as getReminderGet,
  PATCH as updateReminderPatch,
} from "../../app/api/reminders/[reminderId]/route";
import { POST as snoozeReminderPost } from "../../app/api/reminders/[reminderId]/snooze/route";
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
  startNextTestServer,
  type NextTestServer,
  type RouteRegistration,
} from "./next-test-server";
import {
  createRemindersServiceDouble,
  DEFAULT_REMINDERS_AUTH_USER_ID,
  type RemindersServiceDouble,
} from "./reminders-service-double";

export const DEFAULT_AUTH_USERNAME = "alice";

export const remindersRouteRegistrations: ReadonlyArray<RouteRegistration> = [
  { method: "GET", pathname: "/api/reminders", handler: listRemindersGet },
  { method: "POST", pathname: "/api/reminders", handler: createReminderPost },
  {
    method: "GET",
    pathname: "/api/reminders/:reminderId",
    pattern: "/api/reminders/:reminderId",
    handler: getReminderGet,
  },
  {
    method: "PATCH",
    pathname: "/api/reminders/:reminderId",
    pattern: "/api/reminders/:reminderId",
    handler: updateReminderPatch,
  },
  {
    method: "DELETE",
    pathname: "/api/reminders/:reminderId",
    pattern: "/api/reminders/:reminderId",
    handler: deleteReminderDelete,
  },
  {
    method: "POST",
    pathname: "/api/reminders/:reminderId/ack",
    pattern: "/api/reminders/:reminderId/ack",
    handler: ackReminderPost,
  },
  {
    method: "POST",
    pathname: "/api/reminders/:reminderId/snooze",
    pattern: "/api/reminders/:reminderId/snooze",
    handler: snoozeReminderPost,
  },
];

export const authHeaders = (token: string): Headers => {
  return new Headers({
    authorization: `Bearer ${token}`,
  });
};

export type RemindersTestServerOptions = Readonly<{
  remindersService?: RemindersService | RemindersServiceDouble;
  authUserId?: string;
  authUsername?: string;
  accessToken?: string;
  accessMiddlewareDeps?: AccessMiddlewareDeps;
  routes?: ReadonlyArray<RouteRegistration>;
}>;

export type RemindersTestServer = Readonly<{
  baseUrl: string;
  port: number;
  fetch: (pathname: string, init?: RequestInit) => Promise<Response>;
  remindersService: RemindersService;
  listCalls: RemindersServiceDouble["listCalls"];
  createCalls: RemindersServiceDouble["createCalls"];
  accessToken: string;
  authUserId: string;
  close: () => Promise<void>;
}>;

const isRemindersServiceDouble = (
  input: RemindersService | RemindersServiceDouble,
): input is RemindersServiceDouble => {
  return "listCalls" in input && "createCalls" in input && "seed" in input;
};

const resolveRemindersServiceInput = (
  input: RemindersService | RemindersServiceDouble | undefined,
  defaultUserId: string,
): Readonly<{
  remindersService: RemindersService;
  listCalls: RemindersServiceDouble["listCalls"];
  createCalls: RemindersServiceDouble["createCalls"];
}> => {
  if (!input) {
    const double = createRemindersServiceDouble(defaultUserId);
    return {
      remindersService: double,
      listCalls: double.listCalls,
      createCalls: double.createCalls,
    };
  }

  if (isRemindersServiceDouble(input)) {
    return {
      remindersService: input,
      listCalls: input.listCalls,
      createCalls: input.createCalls,
    };
  }

  return {
    remindersService: input,
    listCalls: [],
    createCalls: [],
  };
};

const createAccessToken = async (
  userId: string,
  username: string,
): Promise<string> => {
  const tokenFactory = createTokenFactory();
  const tokens = await tokenFactory.issueTokenPair({ userId, username });
  return tokens.accessToken;
};

/**
 * Starts an in-process api-next test server with reminders routes wired to an
 * injectable RemindersService double.
 */
export const startRemindersTestServer = async (
  options: RemindersTestServerOptions = {},
): Promise<RemindersTestServer> => {
  const authUserId = options.authUserId ?? DEFAULT_REMINDERS_AUTH_USER_ID;
  const authUsername = options.authUsername ?? DEFAULT_AUTH_USERNAME;
  const { remindersService, listCalls, createCalls } = resolveRemindersServiceInput(
    options.remindersService,
    authUserId,
  );

  const services = composeServices();
  setComposedServicesForTests({
    ...services,
    remindersService,
  });

  setAccessMiddlewareDepsForTests(options.accessMiddlewareDeps);

  const accessToken =
    options.accessToken ?? (await createAccessToken(authUserId, authUsername));

  const server = await startNextTestServer({
    routes: options.routes ?? remindersRouteRegistrations,
  });

  const port = Number(new URL(server.baseUrl).port);

  return {
    baseUrl: server.baseUrl,
    port,
    fetch: server.fetch,
    remindersService,
    listCalls,
    createCalls,
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