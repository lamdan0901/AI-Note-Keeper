/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const withoutExport = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
  const eqIndex = withoutExport.indexOf('=');
  if (eqIndex <= 0) return null;

  const key = withoutExport.slice(0, eqIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  let value = withoutExport.slice(eqIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  } else {
    const commentIndex = value.indexOf(' #');
    if (commentIndex >= 0) value = value.slice(0, commentIndex).trim();
  }

  return { key, value };
}

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  }
}

export function loadScriptEnv(scriptDir: string): void {
  const projectRoot = path.resolve(scriptDir, '..');
  // Higher priority first; existing process env always wins.
  loadEnvFile(path.join(projectRoot, '.env.local'));
  loadEnvFile(path.join(projectRoot, '.env'));
}

