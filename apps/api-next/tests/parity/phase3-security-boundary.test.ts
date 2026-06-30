import assert from "node:assert/strict";
import { test } from "node:test";

import { GET as listNotesGet } from "../../app/api/notes/route";
import { GET as listSubscriptionsGet } from "../../app/api/subscriptions/route";
import {
  composeServices,
  resetComposedServicesForTests,
  setComposedServicesForTests,
} from "../../src/server/compose-services";
import { createNotesServiceDouble } from "../support/notes-service-double";
import { mockResolveWebGuestUser, notesRouteRegistrations } from "../support/notes-test-server";
import { createSubscriptionsServiceDouble } from "../support/subscriptions-service-double";
import {
  resetAccessMiddlewareDepsForTests,
  setAccessMiddlewareDepsForTests,
} from "../../src/http/auth/require-access";
import {
  startNextTestServer,
  type RouteRegistration,
} from "../support/next-test-server";

const phase2AuthBoundaryRoutes: ReadonlyArray<RouteRegistration> = [
  notesRouteRegistrations.find((route) => route.pathname === "/api/notes") ?? {
    method: "GET",
    pathname: "/api/notes",
    handler: listNotesGet,
  },
  {
    method: "GET",
    pathname: "/api/subscriptions",
    handler: listSubscriptionsGet,
  },
];

const expectAuthEnvelope = async (response: Response): Promise<void> => {
  const payload = (await response.json()) as { code: string; message: string; status: number };
  assert.equal(response.status, 401);
  assert.deepEqual(Object.keys(payload).sort(), ["code", "message", "status"]);
  assert.equal(payload.code, "auth");
  assert.equal(payload.status, 401);
};

/**
 * Notes + subscriptions subset of backend phase3.security-boundary.test.ts
 * "unauthorized requests across phase-3 routes return auth error contract".
 */
test("unauthenticated GET /api/notes and /api/subscriptions return auth error envelope", async () => {
  const nowRef = { nowMs: () => 1_700_000_000_000 };
  const notesDouble = createNotesServiceDouble();
  const services = composeServices();

  setComposedServicesForTests({
    ...services,
    notesService: notesDouble.notesService,
    subscriptionsService: createSubscriptionsServiceDouble(nowRef),
  });

  setAccessMiddlewareDepsForTests({
    resolveWebGuestUser: mockResolveWebGuestUser,
  });

  const server = await startNextTestServer({
    routes: phase2AuthBoundaryRoutes,
  });

  try {
    await expectAuthEnvelope(await server.fetch("/api/notes"));
    await expectAuthEnvelope(await server.fetch("/api/subscriptions"));
  } finally {
    await server.close();
    resetComposedServicesForTests();
    resetAccessMiddlewareDepsForTests();
  }
});