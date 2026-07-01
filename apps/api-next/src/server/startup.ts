import { evaluateReadiness, type ReadinessStatus } from "@backend/health/readiness";

import {
  initializePoolErrorHandling,
  isDependencyDegraded,
  isRemoteDatabaseUrl,
  pool,
} from "@/db/pool";

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

const describeReadinessFailure = (
  checks: ReadinessStatus["checks"],
): string => {
  if (checks.database === "down") {
    return "database unreachable (check DATABASE_URL, SSL params such as uselibpqcompat=true, and DB_CONNECTION_TIMEOUT_MS)";
  }

  if (checks.migrations === "down") {
    return "schema_migrations missing (run: npm --workspace apps/backend run migrate)";
  }

  return JSON.stringify(checks);
};

const resolveStartupRetryOptions = (): RunInitialStartupChecksOptions => {
  if (process.env.VERCEL === "1") {
    return { maxAttempts: 3, retryDelayMs: 1_000 };
  }

  return { maxAttempts: 5, retryDelayMs: 2_000 };
};

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

const DEFAULT_REMOTE_DB_KEEPALIVE_INTERVAL_MS = 4 * 60 * 1000;

const startRemoteDatabaseKeepalive = (): void => {
  if (process.env.VERCEL === "1" || process.env.DB_KEEPALIVE_INTERVAL_MS === "0") {
    return;
  }

  if (!isRemoteDatabaseUrl()) {
    return;
  }

  const configured = process.env.DB_KEEPALIVE_INTERVAL_MS;
  const intervalMs = configured
    ? Number(configured)
    : DEFAULT_REMOTE_DB_KEEPALIVE_INTERVAL_MS;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return;
  }

  const timer = setInterval(() => {
    void pool.query("SELECT 1").catch(() => {
      // Request-time retries handle transient failures.
    });
  }, intervalMs);
  timer.unref();
};

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
  let lastReadiness: ReadinessStatus | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastReadiness = await readinessProbe();
    if (lastReadiness.ok) {
      return;
    }

    if (attempt < maxAttempts) {
      console.warn(
        `[api-next] startup readiness attempt ${attempt}/${maxAttempts} not ready:`,
        lastReadiness.checks,
      );
      await sleep(retryDelayMs);
    }
  }

  const detail = lastReadiness
    ? describeReadinessFailure(lastReadiness.checks)
    : "readiness probe returned no status";
  throw new Error(`${STARTUP_READINESS_FAILURE_MESSAGE} (${detail})`);
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

    try {
      await runInitialStartupChecks(undefined, resolveStartupRetryOptions());
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
    startRemoteDatabaseKeepalive();
  })();

  return startupPromise;
};