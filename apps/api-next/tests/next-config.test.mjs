import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const apiNextRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function findRouteFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findRouteFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name === "route.ts") {
      files.push(fullPath);
    }
  }

  return files;
}

test("next.config.ts externalizes native Node packages", async () => {
  const configSource = await readFile(
    path.join(apiNextRoot, "next.config.ts"),
    "utf8",
  );

  assert.match(configSource, /serverExternalPackages/);
  assert.match(configSource, /["']pg["']/);
  assert.match(configSource, /["']@node-rs\/argon2["']/);
});

test("API route handlers declare nodejs runtime", async () => {
  const routeFiles = await findRouteFiles(path.join(apiNextRoot, "app"));

  assert.ok(routeFiles.length > 0, "expected at least one app route handler");

  for (const routeFile of routeFiles) {
    const source = await readFile(routeFile, "utf8");
    const relativePath = path.relative(apiNextRoot, routeFile);
    assert.match(
      source,
      /export\s+const\s+runtime\s*=\s*["']nodejs["']/,
      `${relativePath} must export runtime = "nodejs"`,
    );
  }
});