import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const apiNextRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts"]);

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") {
        continue;
      }
      files.push(...(await collectSourceFiles(fullPath)));
      continue;
    }

    const extension = path.extname(entry.name);
    if (SOURCE_EXTENSIONS.has(extension)) {
      files.push(fullPath);
    }
  }

  return files;
}

test("api-next sources import database only through @/db/pool", async () => {
  const sourceRoots = [
    path.join(apiNextRoot, "app"),
    path.join(apiNextRoot, "src"),
    path.join(apiNextRoot, "instrumentation.ts"),
  ];

  const offenders = [];

  for (const sourceRoot of sourceRoots) {
    const files =
      sourceRoot.endsWith(".ts")
        ? [sourceRoot]
        : await collectSourceFiles(sourceRoot);

    for (const file of files) {
      if (file.endsWith(path.join("src", "db", "pool.ts"))) {
        continue;
      }

      const source = await readFile(file, "utf8");
      if (source.includes("@backend/db/pool")) {
        offenders.push(path.relative(apiNextRoot, file));
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `direct @backend/db/pool imports are forbidden outside src/db/pool.ts: ${offenders.join(", ")}`,
  );
});

test("pool wrapper exports initializePoolErrorHandling and isDependencyDegraded", async () => {
  const source = await readFile(
    path.join(apiNextRoot, "src", "db", "pool.ts"),
    "utf8",
  );

  assert.match(source, /export const initializePoolErrorHandling/);
  assert.match(source, /export const isDependencyDegraded/);
  assert.match(source, /removeAllListeners\("error"\)/);
});