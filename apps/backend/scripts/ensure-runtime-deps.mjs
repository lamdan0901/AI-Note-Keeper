import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);

const requiredPackages = ['express', 'dotenv', 'jose', 'pg', 'zod', '@node-rs/argon2'];

const hasRuntimeDeps = requiredPackages.every((packageName) => {
  try {
    require.resolve(packageName);
    return true;
  } catch {
    return false;
  }
});

if (hasRuntimeDeps) {
  process.exit(0);
}

const installResult = spawnSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
  stdio: 'inherit',
});

process.exit(installResult.status ?? 1);
