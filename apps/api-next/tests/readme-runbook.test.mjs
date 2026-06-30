import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const apiNextRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readmePath = path.join(apiNextRoot, "README.md");

const STAGING_QSTASH_MARKERS = [
  "Staging QStash end-to-end verification",
  "REMINDER_SCHEDULER_PROVIDER",
  "REMINDER_SCHEDULER_CALLBACK_BASE_URL",
  "QSTASH_TOKEN",
  "QSTASH_CURRENT_SIGNING_KEY",
  "QSTASH_NEXT_SIGNING_KEY",
  "/internal/reminders/scheduled-task",
  "ngrok",
  "cloudflared",
  "nextTriggerAt",
  "reminders-scheduler-integration.test.ts",
];

const WORKER_LESS_DEV_MARKERS = [
  "Worker-less local development (Phase 5+)",
  "dev:api-next:full",
  "dev:backend:worker",
  "/cron/subscriptions-dispatch",
  "/cron/reminders-repair",
  "CRON_SECRET",
];

const STAGING_24H_WITHOUT_WORKER_MARKERS = [
  "Staging verification: 24h without worker (Phase 5)",
  "test:parity:next",
  "/internal/push/retry",
  "SubscriptionReminderDispatchRunResult",
  "check-subscription-reminders",
  "Rollback drill",
  "15 minutes",
  "pg-boss worker",
  "Worker for maintenance",
  "UTC midnight",
];

test("README documents staging QStash end-to-end verification runbook", async () => {
  const source = await readFile(readmePath, "utf8");

  for (const marker of STAGING_QSTASH_MARKERS) {
    assert.match(
      source,
      new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `README must document runbook marker: ${marker}`,
    );
  }
});

test("README documents worker-less local development runbook", async () => {
  const source = await readFile(readmePath, "utf8");

  for (const marker of WORKER_LESS_DEV_MARKERS) {
    assert.match(
      source,
      new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `README must document worker-less runbook marker: ${marker}`,
    );
  }
});

test("README documents staging 24h without worker verification runbook", async () => {
  const source = await readFile(readmePath, "utf8");

  for (const marker of STAGING_24H_WITHOUT_WORKER_MARKERS) {
    assert.match(
      source,
      new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `README must document staging 24h runbook marker: ${marker}`,
    );
  }
});

