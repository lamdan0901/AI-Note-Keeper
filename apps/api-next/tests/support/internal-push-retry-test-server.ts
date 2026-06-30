import type { PushJobHandler } from "@backend/jobs/push/push-job-handler";
import type { QstashVerifierConfig } from "@backend/reminders/runtime";

import { createPushRetryPostHandler } from "../../src/handlers/internal/push-retry-post";
import type { QstashVerify } from "../../src/http/raw-body";
import {
  createInternalRawRoute,
  startNextTestServer,
  type NextTestServer,
} from "./next-test-server";

export type InternalPushRetryTestServerDeps = Readonly<{
  pushJobHandler: PushJobHandler;
  verifierConfig: QstashVerifierConfig;
  verify?: QstashVerify;
}>;

export const startInternalPushRetryTestServer = async (
  deps: InternalPushRetryTestServerDeps,
): Promise<NextTestServer> => {
  const handler = createPushRetryPostHandler({
    pushJobHandler: deps.pushJobHandler,
    verifierConfig: deps.verifierConfig,
    verify: deps.verify,
  });

  return startNextTestServer({
    routes: [createInternalRawRoute("POST", "/internal/push/retry", handler)],
  });
};