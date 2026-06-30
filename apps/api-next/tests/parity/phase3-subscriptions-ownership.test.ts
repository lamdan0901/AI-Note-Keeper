import assert from "node:assert/strict";
import { test } from "node:test";

import { createTokenFactory } from "@backend/auth/tokens";

import {
  createSubscriptionsServiceDouble,
} from "../support/subscriptions-service-double";
import {
  jsonAuthHeaders,
  startSubscriptionsTestServer,
} from "../support/subscriptions-test-server";

const createAccessToken = async (userId: string): Promise<string> => {
  const tokenFactory = createTokenFactory();
  const pair = await tokenFactory.issueTokenPair({
    userId,
    username: userId,
  });

  return pair.accessToken;
};

/**
 * Subscriptions portion of backend phase3.http.contract.test.ts
 * "subscriptions and device-token mutations reject cross-user ownership violations".
 * Device-token assertions deferred to Phase 4.
 */
test("subscriptions cross-user PATCH rejects ownership violations with not_found envelope", async () => {
  const nowValue = 1_700_000_000_000;
  const nowRef = { nowMs: () => nowValue };
  const server = await startSubscriptionsTestServer({
    nowRef,
    subscriptionsService: createSubscriptionsServiceDouble(nowRef),
    authUserId: "owner-user",
    authUsername: "owner-user",
  });

  const ownerToken = server.accessToken;
  const otherToken = await createAccessToken("other-user");

  try {
    const createSubscription = await server.fetch("/api/subscriptions", {
      method: "POST",
      headers: jsonAuthHeaders(ownerToken),
      body: JSON.stringify({
        serviceName: "Prime",
        category: "streaming",
        price: 15,
        currency: "USD",
        billingCycle: "monthly",
        billingCycleCustomDays: null,
        nextBillingDate: 1_700_864_000_000,
        notes: null,
        trialEndDate: null,
        status: "active",
        reminderDaysBefore: [2],
      }),
    });

    assert.equal(createSubscription.status, 201);
    const createdPayload = (await createSubscription.json()) as { subscription: { id: string } };

    const crossUserPatch = await server.fetch(
      `/api/subscriptions/${createdPayload.subscription.id}`,
      {
        method: "PATCH",
        headers: jsonAuthHeaders(otherToken),
        body: JSON.stringify({ price: 99 }),
      },
    );

    assert.equal(crossUserPatch.status, 404);
    const patchPayload = (await crossUserPatch.json()) as {
      code: string;
      message: string;
      status: number;
    };
    assert.deepEqual(Object.keys(patchPayload).sort(), ["code", "message", "status"]);
    assert.equal(patchPayload.code, "not_found");
    assert.equal(patchPayload.status, 404);
  } finally {
    await server.close();
  }
});