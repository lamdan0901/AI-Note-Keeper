import { AppError } from "@backend/middleware/error-middleware";

import { isDependencyDegraded } from "@/db/pool";

/**
 * Next.js equivalent of Express createDependencyGate middleware.
 * Throws when pool or other tracked dependencies are degraded.
 */
export const assertHealthyDependencies = (): void => {
  if (isDependencyDegraded()) {
    throw new AppError({ code: "internal" });
  }
};