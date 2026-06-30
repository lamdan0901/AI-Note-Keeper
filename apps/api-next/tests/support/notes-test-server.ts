import { createTokenFactory } from "@backend/auth/tokens";
import type { NotesService } from "@backend/notes/service";

import { GET as listNotesGet } from "../../app/api/notes/route";
import { POST as syncNotesPost } from "../../app/api/notes/sync/route";
import { DELETE as emptyTrashDelete } from "../../app/api/notes/trash/empty/route";
import { DELETE as trashNoteDelete } from "../../app/api/notes/[noteId]/route";
import { DELETE as permanentDelete } from "../../app/api/notes/[noteId]/permanent/route";
import { POST as restoreNotePost } from "../../app/api/notes/[noteId]/restore/route";
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
  createNotesServiceDouble,
  type NotesServiceDouble,
} from "./notes-service-double";
import {
  startNextTestServer,
  type NextTestServer,
  type RouteRegistration,
} from "./next-test-server";

export const DEFAULT_GUEST_USER_ID = "web-guest-123e4567-e89b-12d3-a456-426614174000";
export const DEFAULT_AUTH_USER_ID = "notes-harness-user-1";
export const DEFAULT_AUTH_USERNAME = "alice";

export const notesRouteRegistrations: ReadonlyArray<RouteRegistration> = [
  { method: "GET", pathname: "/api/notes", handler: listNotesGet },
  { method: "POST", pathname: "/api/notes/sync", handler: syncNotesPost },
  {
    method: "DELETE",
    pathname: "/api/notes/trash/empty",
    handler: emptyTrashDelete,
  },
  {
    method: "POST",
    pathname: "/api/notes/:noteId/restore",
    pattern: "/api/notes/:noteId/restore",
    handler: restoreNotePost,
  },
  {
    method: "DELETE",
    pathname: "/api/notes/:noteId/permanent",
    pattern: "/api/notes/:noteId/permanent",
    handler: permanentDelete,
  },
  {
    method: "DELETE",
    pathname: "/api/notes/:noteId",
    pattern: "/api/notes/:noteId",
    handler: trashNoteDelete,
  },
];

export type GuestHeadersInput = Readonly<{
  platform: "web" | "mobile";
  guestUserId: string;
}>;

export const authHeaders = (token: string): Headers => {
  return new Headers({
    authorization: `Bearer ${token}`,
  });
};

export const guestHeaders = (input: GuestHeadersInput): Headers => {
  return new Headers({
    "x-client-platform": input.platform,
    "x-guest-user-id": input.guestUserId,
  });
};

export const mockResolveWebGuestUser = async (
  guestUserId: string,
): Promise<Readonly<{ userId: string; username: string }>> => {
  return {
    userId: guestUserId,
    username: `__web_guest_user__${guestUserId}`,
  };
};

export type NotesTestServerOptions = Readonly<{
  notesService?: NotesService | NotesServiceDouble;
  authUserId?: string;
  authUsername?: string;
  accessToken?: string;
  accessMiddlewareDeps?: AccessMiddlewareDeps;
  routes?: ReadonlyArray<RouteRegistration>;
}>;

export type NotesTestServer = Readonly<{
  baseUrl: string;
  port: number;
  fetch: (pathname: string, init?: RequestInit) => Promise<Response>;
  notesService: NotesService;
  calls: ReadonlyArray<NotesServiceDouble["calls"][number]>;
  accessToken: string;
  authUserId: string;
  close: () => Promise<void>;
}>;

const resolveNotesServiceInput = (
  input: NotesService | NotesServiceDouble | undefined,
): Readonly<{ notesService: NotesService; calls: NotesServiceDouble["calls"] }> => {
  if (!input) {
    const double = createNotesServiceDouble();
    return {
      notesService: double.notesService,
      calls: double.calls,
    };
  }

  if ("notesService" in input && "calls" in input) {
    return {
      notesService: input.notesService,
      calls: input.calls,
    };
  }

  return {
    notesService: input,
    calls: [],
  };
};

/**
 * Starts an in-process api-next test server with all Phase 2 notes routes wired
 * to an injectable NotesService (or NotesServiceDouble from createNotesServiceDouble).
 *
 * Guest flows use a mocked resolveWebGuestUser — no database required.
 * Uses an ephemeral localhost port — never binds :3001.
 */
export const startNotesTestServer = async (
  options: NotesTestServerOptions = {},
): Promise<NotesTestServer> => {
  const authUserId = options.authUserId ?? DEFAULT_AUTH_USER_ID;
  const authUsername = options.authUsername ?? DEFAULT_AUTH_USERNAME;
  const { notesService, calls } = resolveNotesServiceInput(options.notesService);

  const services = composeServices();
  setComposedServicesForTests({
    ...services,
    notesService,
  });

  setAccessMiddlewareDepsForTests({
    resolveWebGuestUser: mockResolveWebGuestUser,
    ...options.accessMiddlewareDeps,
  });

  let accessToken = options.accessToken;
  if (!accessToken) {
    const tokenFactory = createTokenFactory();
    const tokens = await tokenFactory.issueTokenPair({
      userId: authUserId,
      username: authUsername,
    });
    accessToken = tokens.accessToken;
  }

  const server = await startNextTestServer({
    routes: options.routes ?? notesRouteRegistrations,
  });

  const port = Number(new URL(server.baseUrl).port);

  return {
    baseUrl: server.baseUrl,
    port,
    fetch: server.fetch,
    notesService,
    calls,
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