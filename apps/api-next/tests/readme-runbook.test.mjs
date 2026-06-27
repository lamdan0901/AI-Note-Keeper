import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const apiNextRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readmePath = path.join(apiNextRoot, "README.md");

const REQUIRED_RUNBOOK_MARKERS = [
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

test("README documents staging QStash end-to-end verification runbook", async () => {
  const source = await readFile(readmePath, "utf8");

  for (const marker of REQUIRED_RUNBOOK_MARKERS) {
    assert.match(
      source,
      new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `README must document runbook marker: ${marker}`,
    );
  }
});