import assert from "node:assert/strict";
import { test } from "node:test";

import { createSubscriptionReminderDispatchJob } from "@backend/jobs/subscriptions/dispatch-due-subscription-reminders";
import { createSubscriptionReminderScanner } from "@backend/jobs/subscriptions/scanner";

import {
  cronAuthHeaders,
  CRON_SUBSCRIPTIONS_DISPATCH_PATH,
  startSubscriptionsDispatchCronTestServer,
} from "./support/subscriptions-dispatch-cron-test-server";

const CRON_SECRET = "test-cron-secret";

const createDispatchJobFixture = () => {
  const enqueued: string[] = [];
  const stateUpdates: string[] = [];

  const job = createSubscriptionReminderDispatchJob({
    now: () => new Date("2026-05-24T12:00:00.000Z"),
    cronStateRepository: {
      getLastCheckedAt: async () => new Date("2026-05-24T11:58:00.000Z"),
      upsertLastCheckedAt: async () => undefined,
    },
    scanner: {
      scanDueReminders: async ({ now, lastCheckedAt }) => ({
        now,
        since: lastCheckedAt ?? now,
        reminders: [
          {
            subscriptionId: "sub-1",
            userId: "user-1",
            kind: "billing",
            triggerTime: new Date("2026-05-24T12:00:00.000Z"),
            anchorDate: new Date("2026-05-27T12:00:00.000Z"),
            title: "Netflix billing reminder",
            body: "Netflix bills in 3 days ($19.99).",
          },
          {
            subscriptionId: "sub-2",
            userId: "user-1",
            kind: "trial_end",
            triggerTime: new Date("2026-05-24T11:59:00.000Z"),
            anchorDate: new Date("2026-05-25T11:59:00.000Z"),
            title: "Prime trial ending",
            body: "Prime trial ends in 1 day.",
          },
        ],
      }),
    },
    queue: {
      enqueue: async (queuedJob) => {
        enqueued.push(`${queuedJob.subscriptionId}:${queuedJob.kind}`);
        return { status: "enqueued" };
      },
    },
    stateRepository: {
      markBillingReminderSent: async ({ subscriptionId }) => {
        stateUpdates.push(`${subscriptionId}:billing`);
      },
      markTrialReminderSent: async ({ subscriptionId }) => {
        stateUpdates.push(`${subscriptionId}:trial_end`);
      },
    },
  });

  return { job, enqueued, stateUpdates };
};

test("subscription reminder scanner returns due billing and trial reminders in window", async () => {
  const now = new Date("2026-05-24T12:00:00.000Z");
  const scanner = createSubscriptionReminderScanner({
    listCandidates: async () => [
      {
        id: "sub-1",
        userId: "user-1",
        serviceName: "Netflix",
        price: 19.99,
        currency: "USD",
        nextBillingDate: new Date("2026-05-27T12:00:00.000Z"),
        trialEndDate: new Date("2026-05-25T12:00:00.000Z"),
        nextReminderAt: new Date("2026-05-24T12:00:00.000Z"),
        lastNotifiedBillingDate: null,
        nextTrialReminderAt: new Date("2026-05-24T11:59:00.000Z"),
        lastNotifiedTrialEndDate: null,
        active: true,
        status: "active",
      },
    ],
  });

  const result = await scanner.scanDueReminders({
    now,
    lastCheckedAt: new Date("2026-05-24T11:58:00.000Z"),
  });

  assert.equal(result.reminders.length, 2);
  assert.equal(result.reminders[0].kind, "trial_end");
  assert.match(result.reminders[0].title, /Netflix trial ending/);
  assert.equal(result.reminders[1].kind, "billing");
  assert.match(result.reminders[1].body, /bills in 3 days/i);
});

test("subscription reminder dispatch enqueues and marks state updates", async () => {
  const { job, enqueued, stateUpdates } = createDispatchJobFixture();

  const result = await job.run();

  assert.equal(result.scanned, 2);
  assert.equal(result.enqueued, 2);
  assert.deepEqual(enqueued, ["sub-1:billing", "sub-2:trial_end"]);
  assert.deepEqual(stateUpdates, ["sub-1:billing", "sub-2:trial_end"]);
});

test("subscription reminder dispatch cron POST returns summary JSON matching job output", async () => {
  const { job: expectedJob } = createDispatchJobFixture();
  const expected = await expectedJob.run();

  const { job, enqueued, stateUpdates } = createDispatchJobFixture();
  const server = await startSubscriptionsDispatchCronTestServer({
    dispatchJob: job,
    cronSecret: CRON_SECRET,
  });

  try {
    const response = await server.fetch(CRON_SUBSCRIPTIONS_DISPATCH_PATH, {
      method: "POST",
      headers: cronAuthHeaders(CRON_SECRET),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      cronKey: expected.cronKey,
      since: expected.since.toISOString(),
      now: expected.now.toISOString(),
      scanned: expected.scanned,
      enqueued: expected.enqueued,
      duplicates: expected.duplicates,
    });
    assert.deepEqual(enqueued, ["sub-1:billing", "sub-2:trial_end"]);
    assert.deepEqual(stateUpdates, ["sub-1:billing", "sub-2:trial_end"]);
  } finally {
    await server.close();
  }
});