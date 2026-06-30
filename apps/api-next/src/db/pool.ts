import { pool as backendPool } from "@backend/db/pool";

export type PoolErrorLogger = Readonly<{
  error: (message: string, error?: unknown) => void;
}>;

export type InitializePoolErrorHandlingOptions = Readonly<{
  onDependencyDegraded?: (error: Error) => void;
  logger?: PoolErrorLogger;
}>;

export type PoolErrorEventTarget = Readonly<{
  removeAllListeners: (event?: string | symbol) => unknown;
  on: (event: "error", listener: (error: Error) => void) => unknown;
}>;

const defaultLogger: PoolErrorLogger = {
  error: (message, error) => {
    console.error(message, error);
  },
};

let dependencyDegraded = false;

/**
 * Attaches non-fatal pool error handling to a target that mirrors pg.Pool events.
 * Exported for unit tests; production callers should use initializePoolErrorHandling().
 */
export const attachSoftPoolErrorHandling = (
  target: PoolErrorEventTarget,
  options: InitializePoolErrorHandlingOptions = {},
): void => {
  const logger = options.logger ?? defaultLogger;

  target.removeAllListeners("error");
  target.on("error", (error) => {
    dependencyDegraded = true;

    if (options.onDependencyDegraded) {
      options.onDependencyDegraded(error);
      return;
    }

    logger.error("[backend] database dependency degraded", error);
  });
};

export const initializePoolErrorHandling = (
  options: InitializePoolErrorHandlingOptions = {},
): void => {
  attachSoftPoolErrorHandling(backendPool, options);
};

export const isDependencyDegraded = (): boolean => dependencyDegraded;

/** Test-only reset for module-scoped degraded state. */
export const resetPoolErrorStateForTests = (): void => {
  dependencyDegraded = false;
};

/** Re-export backend pool — the only allowed DB import path in api-next. */
export const pool = backendPool;