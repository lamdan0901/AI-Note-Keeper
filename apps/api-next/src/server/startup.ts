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

export const runInitialStartupChecks = async (
  readinessProbe: () => Promise<ReadinessStatus> = () =>
    evaluateReadiness({
      queryClient: pool,
      dependencyDegraded: false,
    }),
): Promise<void> => {
  const readiness = await readinessProbe();

  if (!readiness.ok) {
    throw new Error(
      "Initial readiness check failed: database connectivity and schema_migrations are required.",
    );
  }
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
    await runInitialStartupChecks();
    initializePoolErrorHandling();
  })();

  return startupPromise;
};