import { pathToFileURL } from 'node:url';

import { startApiRuntime } from './runtime/startApi.js';

export { createApiServer as createApp } from './runtime/createApiServer.js';
export { runInitialStartupChecks } from './runtime/startApi.js';
export const startServer = startApiRuntime;

const isMainModule = (): boolean => {
  const executedPath = process.argv[1];

  if (!executedPath) {
    return false;
  }

  return pathToFileURL(executedPath).href === import.meta.url;
};

if (isMainModule()) {
  startApiRuntime().catch((error) => {
    console.error('[backend] startup failed', error);
    process.exit(1);
  });
}