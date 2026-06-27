import type { ReminderRepairJob } from "@/server/reminder-repair";

import { createRemindersRepairCronHandler } from "../../src/handlers/cron/reminders-repair";
import {
  resetCronAuthConfigForTests,
  setCronAuthConfigForTests,
} from "../../src/http/auth/require-cron";
import { startNextTestServer, type NextTestServer } from "./next-test-server";

export type RemindersRepairCronTestServerDeps = Readonly<{
  repairJob: ReminderRepairJob;
  cronSecret?: string;
}>;

const CRON_PATH = "/cron/reminders-repair";

export const startRemindersRepairCronTestServer = async (
  deps: RemindersRepairCronTestServerDeps,
): Promise<NextTestServer> => {
  const cronSecret = deps.cronSecret ?? "test-cron-secret";
  setCronAuthConfigForTests({ cronSecret });

  const handler = createRemindersRepairCronHandler({ repairJob: deps.repairJob });

  const server = await startNextTestServer({
    routes: [
      { method: "GET", pathname: CRON_PATH, handler },
      { method: "POST", pathname: CRON_PATH, handler },
    ],
  });

  return {
    ...server,
    close: async () => {
      resetCronAuthConfigForTests();
      await server.close();
    },
  };
};