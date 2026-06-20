import { copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const backendRoot = path.resolve(scriptDir, '..');
const sourceDir = path.join(backendRoot, 'src', 'db', 'migrations');
const targetDir = path.join(backendRoot, 'dist', 'db', 'migrations');

await mkdir(targetDir, { recursive: true });

const entries = await readdir(sourceDir, { withFileTypes: true });
const sqlFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.sql'));

await Promise.all(
  sqlFiles.map((entry) =>
    copyFile(path.join(sourceDir, entry.name), path.join(targetDir, entry.name)),
  ),
);
