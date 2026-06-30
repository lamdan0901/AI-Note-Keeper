import type { SubscriptionReminderDispatchJob } from "@backend/jobs/subscriptions/dispatch-due-subscription-reminders";

import { createSubscriptionsDispatchCronHandler } from "../../src/handlers/cron/subscriptions-dispatch";
import {
  resetCronAuthConfigForTests,
  setCronAuthConfigForTests,
} from "../../src/http/auth/require-cron";
import { startNextTestServer, type NextTestServer } from "./next-test-server";

export type SubscriptionsDispatchCronTestServerDeps = Readonly<{
  dispatchJob: SubscriptionReminderDispatchJob;
  cronSecret?: string;
}>;

export const CRON_SUBSCRIPTIONS_DISPATCH_PATH = "/cron/subscriptions-dispatch";

export const cronAuthHeaders = (cronSecret: string): Readonly<Record<string, string>> => ({
  authorization: `Bearer ${cronSecret}`,
});

export const startSubscriptionsDispatchCronTestServer = async (
  deps: SubscriptionsDispatchCronTestServerDeps,
): Promise<NextTestServer> => {
  const cronSecret = deps.cronSecret ?? "test-cron-secret";
  setCronAuthConfigForTests({ cronSecret });

  const handler = createSubscriptionsDispatchCronHandler({ dispatchJob: deps.dispatchJob });

  const server = await startNextTestServer({
    routes: [
      { method: "GET", pathname: CRON_SUBSCRIPTIONS_DISPATCH_PATH, handler },
      { method: "POST", pathname: CRON_SUBSCRIPTIONS_DISPATCH_PATH, handler },
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