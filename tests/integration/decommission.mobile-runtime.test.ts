import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const MOBILE_SRC_ROOT = path.resolve(__dirname, '../../apps/mobile/src');
const MOBILE_ENV_EXAMPLE = path.resolve(__dirname, '../../apps/mobile/.env.example');
const MOBILE_EAS_JSON = path.resolve(__dirname, '../../apps/mobile/eas.json');
const MOBILE_PACKAGE_JSON = path.resolve(__dirname, '../../apps/mobile/package.json');

const MOBILE_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

const collectSourceFiles = (root: string): string[] => {
  const entries = readdirSync(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (MOBILE_SOURCE_EXTENSIONS.has(extension)) {
      files.push(fullPath);
    }
  }

  return files;
};

const normalizePath = (filePath: string): string => {
  return path.relative(path.resolve(__dirname, '../..'), filePath).split('\\').join('/');
};

describe('phase-8 decommission mobile runtime guard', () => {
  it('mobile source files do not import Convex runtime modules', () => {
    const sourceFiles = collectSourceFiles(MOBILE_SRC_ROOT);

    const forbiddenMatches = sourceFiles.flatMap((filePath) => {
      const content = readFileSync(filePath, 'utf8');
      const matches: string[] = [];

      if (/from\s+['"]convex\//.test(content)) {
        matches.push(`${normalizePath(filePath)} :: convex/* import`);
      }

      if (/convex\/_generated\/api/.test(content)) {
        matches.push(`${normalizePath(filePath)} :: generated Convex API import`);
      }

      return matches;
    });

    expect(forbiddenMatches).toEqual([]);
  });

  it('mobile runtime does not expose Convex UI gates or env keys', () => {
    const appContent = readFileSync(path.resolve(__dirname, '../../apps/mobile/App.tsx'), 'utf8');
    const tabBar = readFileSync(
      path.resolve(__dirname, '../../apps/mobile/src/components/BottomTabBar.tsx'),
      'utf8',
    );
    const settings = readFileSync(
      path.resolve(__dirname, '../../apps/mobile/src/screens/SettingsScreen.tsx'),
      'utf8',
    );
    const envExample = readFileSync(MOBILE_ENV_EXAMPLE, 'utf8');
    const easConfig = readFileSync(MOBILE_EAS_JSON, 'utf8');

    expect(appContent).not.toContain('hasConvexClient');
    expect(tabBar).not.toContain('hasConvexClient');
    expect(settings).not.toContain('hasConvexClient');
    expect(envExample).not.toContain('EXPO_PUBLIC_CONVEX_URL');
    expect(easConfig).not.toContain('EXPO_PUBLIC_CONVEX_URL');
  });

  it('mobile package manifest does not include convex dependency', () => {
    const packageManifest = JSON.parse(readFileSync(MOBILE_PACKAGE_JSON, 'utf8')) as {
      dependencies?: Record<string, unknown>;
    };

    expect(packageManifest.dependencies ?? {}).not.toHaveProperty('convex');
  });
});
