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
  "x-vercel-cron: 1",
];

const STAGING_24H_WITHOUT_WORKER_MARKERS = [
  "Staging verification: 24h without worker (Phase 5)",
  "test:parity:next",
  "vercel.json",
  "/internal/push/retry",
  "SubscriptionReminderDispatchRunResult",
  "check-subscription-reminders",
  "Rollback drill",
  "15 minutes",
  "Scale the pg-boss worker",
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

test("vercel.json defines maintenance cron schedules", async () => {
  const vercelPath = path.join(apiNextRoot, "vercel.json");
  const source = await readFile(vercelPath, "utf8");
  const config = JSON.parse(source);

  assert.ok(Array.isArray(config.crons), "vercel.json must define crons array");

  const paths = config.crons.map((entry) => entry.path);
  assert.ok(
    paths.includes("/cron/reminders-repair"),
    "vercel.json must schedule /cron/reminders-repair",
  );
  assert.ok(
    paths.includes("/cron/subscriptions-dispatch"),
    "vercel.json must schedule /cron/subscriptions-dispatch",
  );

  const repairCron = config.crons.find((entry) => entry.path === "/cron/reminders-repair");
  assert.equal(repairCron.schedule, "*/15 * * * *");

  const dispatchCron = config.crons.find(
    (entry) => entry.path === "/cron/subscriptions-dispatch",
  );
  assert.equal(dispatchCron.schedule, "0 0 * * *");
});