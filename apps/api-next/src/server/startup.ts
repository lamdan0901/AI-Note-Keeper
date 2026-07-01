import { evaluateReadiness, type ReadinessStatus } from "@backend/health/readiness";

import { initializePoolErrorHandling, isDependencyDegraded, pool } from "@/db/pool";

export { isDependencyDegraded };

export const createReadinessProbe = (): (() => Promise<ReadinessStatus>) => {
  return () =>
    evaluateReadiness({
      queryClient: pool,
      dependencyDegraded: isDependencyDegraded(),
    });
};

export type RunInitialStartupChecksOptions = Readonly<{
  maxAttempts?: number;
  retryDelayMs?: number;
}>;

const STARTUP_READINESS_FAILURE_MESSAGE =
  "Initial readiness check failed: database connectivity and schema_migrations are required.";

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

export const runInitialStartupChecks = async (
  readinessProbe: () => Promise<ReadinessStatus> = () =>
    evaluateReadiness({
      queryClient: pool,
      dependencyDegraded: false,
    }),
  options: RunInitialStartupChecksOptions = {},
): Promise<void> => {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 1);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 0);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const readiness = await readinessProbe();
    if (readiness.ok) {
      return;
    }

    if (attempt < maxAttempts) {
      await sleep(retryDelayMs);
    }
  }

  throw new Error(STARTUP_READINESS_FAILURE_MESSAGE);
};

let startupPromise: Promise<void> | null = null;

/**
 * Mirrors Express startApi.ts ordering: initial readiness probe (may create pool),
 * then replace fatal pool error listener before serving traffic.
 */
export const ensureApiNextStartup = async (): Promise<void> => {
  if (startupPromise !== null) {
    return startupPromise;
  }

  startupPromise = (async () => {
    const isVercel = process.env.VERCEL === "1";
    const startupOptions: RunInitialStartupChecksOptions = isVercel
      ? { maxAttempts: 3, retryDelayMs: 1_000 }
      : {};

    try {
      await runInitialStartupChecks(undefined, startupOptions);
    } catch (error) {
      if (!isVercel) {
        throw error;
      }

      console.warn(
        "[api-next] startup readiness check failed on Vercel boot; deferring to request-time checks",
        error,
      );
    }

    initializePoolErrorHandling();
  })();

  return startupPromise;
};