import assert from "node:assert/strict";
import { test } from "node:test";

import type { SubscriptionReminderDispatchRunResult } from "@backend/jobs/subscriptions/dispatch-due-subscription-reminders";
import { NextRequest } from "next/server";

import { createSubscriptionsDispatchCronHandler } from "../src/handlers/cron/subscriptions-dispatch";
import {
  resetCronAuthConfigForTests,
  setCronAuthConfigForTests,
} from "../src/http/auth/require-cron";

const CRON_SECRET = "test-cron-secret";
const CRON_PATH = "http://localhost:3001/cron/subscriptions-dispatch";

const sampleRunResult: SubscriptionReminderDispatchRunResult = {
  cronKey: "check-subscription-reminders",
  since: new Date("2026-06-28T00:00:00.000Z"),
  now: new Date("2026-06-29T00:00:00.000Z"),
  scanned: 2,
  enqueued: 1,
  duplicates: 1,
};

const createDispatchJobDouble = (runResult: SubscriptionReminderDispatchRunResult = sampleRunResult) => {
  let runCount = 0;

  return {
    dispatchJob: {
      run: async () => {
        runCount += 1;
        return runResult;
      },
    },
    getRunCount: () => runCount,
  };
};

test("subscriptions dispatch cron handler rejects unauthenticated requests", async () => {
  setCronAuthConfigForTests({ cronSecret: CRON_SECRET });
  const { dispatchJob, getRunCount } = createDispatchJobDouble();

  try {
    const handler = createSubscriptionsDispatchCronHandler({ dispatchJob });
    const response = await handler(new NextRequest(CRON_PATH, { method: "GET" }));

    assert.equal(response.status, 401);
    const payload = (await response.json()) as Record<string, unknown>;
    assert.equal(payload.code, "auth");
    assert.equal(payload.message, "Invalid cron authorization");
    assert.equal(payload.status, 401);
    assert.equal(getRunCount(), 0);
  } finally {
    resetCronAuthConfigForTests();
  }
});

test("subscriptions dispatch cron handler returns dispatch summary on authorized request", async () => {
  setCronAuthConfigForTests({ cronSecret: CRON_SECRET });
  const { dispatchJob, getRunCount } = createDispatchJobDouble();

  try {
    const handler = createSubscriptionsDispatchCronHandler({ dispatchJob });
    const response = await handler(
      new NextRequest(CRON_PATH, {
        method: "POST",
        headers: {
          authorization: `Bearer ${CRON_SECRET}`,
        },
      }),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      cronKey: "check-subscription-reminders",
      since: "2026-06-28T00:00:00.000Z",
      now: "2026-06-29T00:00:00.000Z",
      scanned: 2,
      enqueued: 1,
      duplicates: 1,
    });
    assert.equal(getRunCount(), 1);
  } finally {
    resetCronAuthConfigForTests();
  }
});