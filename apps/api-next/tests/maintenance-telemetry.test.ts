import assert from "node:assert/strict";
import { test } from "node:test";

import { composeServices } from "../src/server/compose-services";
import { getMaintenanceTelemetry } from "../src/server/maintenance-telemetry";

const qstashEnv = {
  provider: "qstash",
  callbackBaseUrl: "https://api.example.test",
  token: "qstash-token",
  currentSigningKey: "current-signing-key",
  nextSigningKey: "next-signing-key",
} as const;

const saveQstashEnv = (): Record<string, string | undefined> => ({
  provider: process.env.REMINDER_SCHEDULER_PROVIDER,
  callbackBaseUrl: process.env.REMINDER_SCHEDULER_CALLBACK_BASE_URL,
  token: process.env.QSTASH_TOKEN,
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
});

const restoreEnv = (saved: Record<string, string | undefined>): void => {
  for (const [key, value] of Object.entries(saved)) {
    const envKey =
      key === "provider"
        ? "REMINDER_SCHEDULER_PROVIDER"
        : key === "callbackBaseUrl"
          ? "REMINDER_SCHEDULER_CALLBACK_BASE_URL"
          : key === "token"
            ? "QSTASH_TOKEN"
            : key === "currentSigningKey"
              ? "QSTASH_CURRENT_SIGNING_KEY"
              : "QSTASH_NEXT_SIGNING_KEY";

    if (value === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = value;
    }
  }
};

const applyQstashEnv = (): void => {
  process.env.REMINDER_SCHEDULER_PROVIDER = qstashEnv.provider;
  process.env.REMINDER_SCHEDULER_CALLBACK_BASE_URL = qstashEnv.callbackBaseUrl;
  process.env.QSTASH_TOKEN = qstashEnv.token;
  process.env.QSTASH_CURRENT_SIGNING_KEY = qstashEnv.currentSigningKey;
  process.env.QSTASH_NEXT_SIGNING_KEY = qstashEnv.nextSigningKey;
};

test("getMaintenanceTelemetry reports all maintenance paths when qstash scheduler is enabled", () => {
  const saved = saveQstashEnv();
  applyQstashEnv();

  try {
    const telemetry = getMaintenanceTelemetry(composeServices());

    assert.deepEqual(telemetry, {
      remindersRepair: true,
      subscriptionsDispatch: true,
      pushRetryCallback: true,
    });
  } finally {
    restoreEnv(saved);
  }
});

test("getMaintenanceTelemetry reports disabled maintenance paths when scheduler is disabled", () => {
  const saved = saveQstashEnv();
  process.env.REMINDER_SCHEDULER_PROVIDER = "disabled";

  try {
    const telemetry = getMaintenanceTelemetry(composeServices());

    assert.deepEqual(telemetry, {
      remindersRepair: false,
      subscriptionsDispatch: false,
      pushRetryCallback: false,
    });
  } finally {
    restoreEnv(saved);
  }
});