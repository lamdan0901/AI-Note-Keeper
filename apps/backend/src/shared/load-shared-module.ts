import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const sharedPackageRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'packages',
  'shared',
);

/** Load a shared-package module at runtime; path is not statically analyzable by bundlers. */
export const loadSharedModule = <T extends Record<string, unknown>>(
  moduleSuffix: string,
): T | null => {
  try {
    return require(join(sharedPackageRoot, moduleSuffix)) as T;
  } catch {
    return null;
  }
};