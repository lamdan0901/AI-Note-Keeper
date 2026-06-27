import type { QstashVerifierConfig } from "@backend/reminders/runtime";
import type { ScheduledTaskExecutor } from "@backend/reminders/scheduled-task-executor";

import { createScheduledTaskPostHandler } from "../../src/handlers/internal/scheduled-task-post";
import type { QstashVerify } from "../../src/http/raw-body";
import {
  createInternalRawRoute,
  startNextTestServer,
  type NextTestServer,
} from "./next-test-server";

export type InternalTestServerDeps = Readonly<{
  executor: ScheduledTaskExecutor;
  verifierConfig: QstashVerifierConfig;
  verify?: QstashVerify;
}>;

export const startInternalTestServer = async (
  deps: InternalTestServerDeps,
): Promise<NextTestServer> => {
  const handler = createScheduledTaskPostHandler({
    executor: deps.executor,
    verifierConfig: deps.verifierConfig,
    verify: deps.verify,
  });

  return startNextTestServer({
    routes: [
      createInternalRawRoute("POST", "/internal/reminders/scheduled-task", handler),
    ],
  });
};