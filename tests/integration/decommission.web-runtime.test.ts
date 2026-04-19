import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const WEB_SRC_ROOT = path.resolve(__dirname, '../../apps/web/src');
const WEB_ENV_EXAMPLE = path.resolve(__dirname, '../../apps/web/.env.example');

const WEB_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

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
    if (WEB_SOURCE_EXTENSIONS.has(extension)) {
      files.push(fullPath);
    }
  }

  return files;
};

const normalizePath = (filePath: string): string => {
  return path.relative(path.resolve(__dirname, '../..'), filePath).split('\\').join('/');
};

describe('phase-8 decommission web runtime guard', () => {
  it('web source files do not import Convex runtime modules', () => {
    const sourceFiles = collectSourceFiles(WEB_SRC_ROOT);

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

  it('web auth and env configuration do not require VITE_CONVEX_URL', () => {
    const authContextPath = path.resolve(WEB_SRC_ROOT, 'auth/AuthContext.tsx');
    const authContextContent = readFileSync(authContextPath, 'utf8');
    const envContent = readFileSync(WEB_ENV_EXAMPLE, 'utf8');

    expect(authContextContent).not.toContain('VITE_CONVEX_URL');
    expect(envContent).not.toContain('VITE_CONVEX_URL');
  });
});
