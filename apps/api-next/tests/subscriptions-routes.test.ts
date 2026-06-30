import assert from "node:assert/strict";
import { test } from "node:test";

import { createTokenFactory } from "@backend/auth/tokens";

import {
  DAY_MS,
  createSubscriptionsServiceDouble,
} from "./support/subscriptions-service-double";
import {
  jsonAuthHeaders,
  startSubscriptionsTestServer,
} from "./support/subscriptions-test-server";

test("subscriptions routes derive reminder fields on create and update", async () => {
  let nowValue = 1_700_000_000_000;
  const nowRef = { nowMs: () => nowValue };
  const server = await startSubscriptionsTestServer({
    nowRef,
    subscriptionsService: createSubscriptionsServiceDouble(nowRef),
    authUserId: "user-1",
  });

  try {
    const createResponse = await server.fetch("/api/subscriptions", {
      method: "POST",
      headers: jsonAuthHeaders(server.accessToken),
      body: JSON.stringify({
        serviceName: "Netflix",
        category: "streaming",
        price: 10,
        currency: "USD",
        billingCycle: "monthly",
        billingCycleCustomDays: null,
        nextBillingDate: nowValue + 10 * DAY_MS,
        notes: null,
        trialEndDate: nowValue + 4 * DAY_MS,
        status: "active",
        reminderDaysBefore: [2, 5],
      }),
    });

    assert.equal(createResponse.status, 201);
    const createdPayload = (await createResponse.json()) as {
      subscription: {
        id: string;
        nextReminderAt: string | null;
        nextTrialReminderAt: string | null;
      };
    };
    assert.ok(createdPayload.subscription.nextReminderAt);
    assert.ok(createdPayload.subscription.nextTrialReminderAt);

    nowValue += DAY_MS;
    const updateResponse = await server.fetch(
      `/api/subscriptions/${createdPayload.subscription.id}`,
      {
        method: "PATCH",
        headers: jsonAuthHeaders(server.accessToken),
        body: JSON.stringify({
          nextBillingDate: nowValue + 20 * DAY_MS,
          reminderDaysBefore: [3],
        }),
      },
    );

    assert.equal(updateResponse.status, 200);
    const updatedPayload = (await updateResponse.json()) as {
      subscription: { nextReminderAt: string | null };
    };
    assert.ok(updatedPayload.subscription.nextReminderAt);
  } finally {
    await server.close();
  }
});

test("subscriptions update enforces ownership by user-scoped lookup", async () => {
  const nowValue = 1_700_000_000_000;
  const nowRef = { nowMs: () => nowValue };
  const service = createSubscriptionsServiceDouble(nowRef);
  const server = await startSubscriptionsTestServer({
    nowRef,
    subscriptionsService: service,
    authUserId: "owner",
    authUsername: "owner",
  });

  const tokenFactory = createTokenFactory();
  const otherTokens = await tokenFactory.issueTokenPair({
    userId: "other",
    username: "other",
  });

  try {
    const createResponse = await server.fetch("/api/subscriptions", {
      method: "POST",
      headers: jsonAuthHeaders(server.accessToken),
      body: JSON.stringify({
        serviceName: "Prime",
        category: "streaming",
        price: 15,
        currency: "USD",
        billingCycle: "monthly",
        billingCycleCustomDays: null,
        nextBillingDate: nowValue + 10 * DAY_MS,
        notes: null,
        trialEndDate: null,
        status: "active",
        reminderDaysBefore: [2],
      }),
    });

    const createdPayload = (await createResponse.json()) as { subscription: { id: string } };

    const forbiddenUpdate = await server.fetch(
      `/api/subscriptions/${createdPayload.subscription.id}`,
      {
        method: "PATCH",
        headers: jsonAuthHeaders(otherTokens.accessToken),
        body: JSON.stringify({
          price: 20,
        }),
      },
    );

    assert.equal(forbiddenUpdate.status, 404);
    const errorPayload = (await forbiddenUpdate.json()) as {
      code: string;
      message: string;
      status: number;
    };
    assert.equal(errorPayload.code, "not_found");
    assert.equal(errorPayload.status, 404);
  } finally {
    await server.close();
  }
});

test("subscription purge uses 14-day deletedAt cutoff", async () => {
  let nowValue = 1_700_000_000_000;
  const nowRef = { nowMs: () => nowValue };
  const service = createSubscriptionsServiceDouble(nowRef);

  const created = await service.create({
    userId: "user-1",
    serviceName: "Trashable",
    category: "misc",
    price: 1,
    currency: "USD",
    billingCycle: "monthly",
    billingCycleCustomDays: null,
    nextBillingDate: new Date(nowValue + 10 * DAY_MS),
    notes: null,
    trialEndDate: null,
    status: "active",
    reminderDaysBefore: [1],
  });

  await service.trash({
    userId: "user-1",
    subscriptionId: created.id,
  });

  nowValue += 13 * DAY_MS;
  assert.equal(await service.purgeExpiredTrash({ userId: "user-1" }), 0);

  nowValue += 2 * DAY_MS;
  assert.equal(await service.purgeExpiredTrash({ userId: "user-1" }), 1);
});