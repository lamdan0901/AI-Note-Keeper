import type { MergeService } from "@backend/merge/service";
import { AppError } from "@backend/middleware/error-middleware";

/**
 * Stateful MergeService double mirroring backend merge/routes.test.ts contract behavior.
 */
export const createMergeServiceDouble = (): MergeService => {
  return {
    preflight: async ({ fromUserId, toUserId }) => {
      return {
        summary: {
          sourceEmpty: false,
          sourceSampleOnly: false,
          targetEmpty: false,
          hasConflicts: fromUserId !== toUserId,
          sourceCounts: {
            notes: 2,
            subscriptions: 1,
            tokens: 1,
            events: 1,
            expensePeriods: 2,
            expenseRows: 5,
          },
          targetCounts: {
            notes: 1,
            subscriptions: 0,
            tokens: 1,
            events: 0,
            expensePeriods: 1,
            expenseRows: 3,
          },
        },
      };
    },

    apply: async ({ strategy, password, fromUserId, toUserId }) => {
      if (password === "blocked") {
        throw new AppError({
          code: "rate_limit",
          details: {
            retryAfterSeconds: 12,
            resetAt: 1_700_000_012_000,
            internalStack: "should-not-leak",
          },
        });
      }

      return {
        strategy,
        resolution: strategy === "both" ? "prompt" : strategy,
        summary: {
          sourceEmpty: false,
          sourceSampleOnly: false,
          targetEmpty: false,
          hasConflicts: fromUserId !== toUserId,
          sourceCounts: {
            notes: 2,
            subscriptions: 1,
            tokens: 1,
            events: 1,
            expensePeriods: 2,
            expenseRows: 5,
          },
          targetCounts: {
            notes: strategy === "cloud" ? 1 : 2,
            subscriptions: 1,
            tokens: 1,
            events: 1,
            expensePeriods: 1,
            expenseRows: 3,
          },
        },
      };
    },
  };
};