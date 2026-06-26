import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const apiNextRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envExamplePath = path.join(apiNextRoot, ".env.example");

const REQUIRED_VARS = [
  "API_NEXT_PORT",
  "DATABASE_URL",
  "JWT_ISSUER",
  "JWT_AUDIENCE",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "LEGACY_UPGRADE_SECRET",
  "JWT_ACCESS_TTL_SECONDS",
  "JWT_REFRESH_TTL_SECONDS",
  "REMINDER_SCHEDULER_PROVIDER",
  "REMINDER_SCHEDULER_CALLBACK_BASE_URL",
  "QSTASH_TOKEN",
  "QSTASH_CURRENT_SIGNING_KEY",
  "QSTASH_NEXT_SIGNING_KEY",
  "CORS_ALLOWED_ORIGINS",
];

test(".env.example documents canonical api-next environment variables", async () => {
  const source = await readFile(envExamplePath, "utf8");

  for (const variable of REQUIRED_VARS) {
    assert.match(
      source,
      new RegExp(`(?:^|\\n)#?\\s*${variable}=`, "m"),
      `.env.example must document ${variable}`,
    );
  }

  assert.doesNotMatch(
    source,
    /(?:^|\n)#?\s*QSTASH_CALLBACK_BASE_URL=/m,
    "use REMINDER_SCHEDULER_CALLBACK_BASE_URL (not QSTASH_CALLBACK_BASE_URL)",
  );

  assert.match(
    source,
    /localhost.*tunnel|tunnel.*localhost|cannot reach.*localhost/i,
    ".env.example must note that QStash cannot reach localhost without a tunnel",
  );

  assert.match(
    source,
    /REMINDER_SCHEDULER_CALLBACK_BASE_URL/,
    ".env.example must reference canonical callback base URL variable",
  );
});