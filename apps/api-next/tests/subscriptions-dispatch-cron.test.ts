import assert from "node:assert/strict";
import { test } from "node:test";

import type { SubscriptionReminderDispatchRunResult } from "@backend/jobs/subscriptions/dispatch-due-subscription-reminders";

import {
  cronAuthHeaders,
  CRON_SUBSCRIPTIONS_DISPATCH_PATH,
  startSubscriptionsDispatchCronTestServer,
} from "./support/subscriptions-dispatch-cron-test-server";

const CRON_SECRET = "test-cron-secret";

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

test("subscriptions dispatch cron returns summary on authorized GET", async () => {
  const { dispatchJob, getRunCount } = createDispatchJobDouble();
  const server = await startSubscriptionsDispatchCronTestServer({
    dispatchJob,
    cronSecret: CRON_SECRET,
  });

  try {
    const response = await server.fetch(CRON_SUBSCRIPTIONS_DISPATCH_PATH, {
      method: "GET",
      headers: cronAuthHeaders(CRON_SECRET),
    });

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
    await server.close();
  }
});

test("subscriptions dispatch cron supports POST for manual maintenance invocations", async () => {
  const { dispatchJob, getRunCount } = createDispatchJobDouble();
  const server = await startSubscriptionsDispatchCronTestServer({
    dispatchJob,
    cronSecret: CRON_SECRET,
  });

  try {
    const response = await server.fetch(CRON_SUBSCRIPTIONS_DISPATCH_PATH, {
      method: "POST",
      headers: cronAuthHeaders(CRON_SECRET),
    });

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
    await server.close();
  }
});

test("subscriptions dispatch cron rejects unauthenticated requests", async () => {
  const { dispatchJob, getRunCount } = createDispatchJobDouble();
  const server = await startSubscriptionsDispatchCronTestServer({
    dispatchJob,
    cronSecret: CRON_SECRET,
  });

  try {
    const response = await server.fetch(CRON_SUBSCRIPTIONS_DISPATCH_PATH, { method: "GET" });

    assert.equal(response.status, 401);
    const payload = (await response.json()) as Record<string, unknown>;
    assert.equal(payload.code, "auth");
    assert.equal(payload.message, "Invalid cron authorization");
    assert.equal(payload.status, 401);
    assert.equal(getRunCount(), 0);
  } finally {
    await server.close();
  }
});

test("subscriptions dispatch cron rejects invalid bearer token", async () => {
  const { dispatchJob, getRunCount } = createDispatchJobDouble();
  const server = await startSubscriptionsDispatchCronTestServer({
    dispatchJob,
    cronSecret: CRON_SECRET,
  });

  try {
    const response = await server.fetch(CRON_SUBSCRIPTIONS_DISPATCH_PATH, {
      method: "GET",
      headers: cronAuthHeaders("wrong-secret"),
    });

    assert.equal(response.status, 401);
    const payload = (await response.json()) as Record<string, unknown>;
    assert.equal(payload.code, "auth");
    assert.equal(payload.message, "Invalid cron authorization");
    assert.equal(getRunCount(), 0);
  } finally {
    await server.close();
  }
});