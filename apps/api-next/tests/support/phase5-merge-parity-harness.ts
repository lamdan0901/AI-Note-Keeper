import type {
  MergeApplyInput,
  MergePreflightInput,
  MergeResolution,
} from "@backend/merge/contracts";
import type { MergeService } from "@backend/merge/service";
import { AppError } from "@backend/middleware/error-middleware";

export type MergeTransactionStats = Readonly<{
  started: number;
  committed: number;
  rolledBack: number;
}>;

export type MutableMergeTransactionStats = {
  started: number;
  committed: number;
  rolledBack: number;
};

const createSummary = (targetNotes: number) => ({
  sourceEmpty: false,
  sourceSampleOnly: false,
  targetEmpty: false,
  hasConflicts: true,
  sourceCounts: {
    notes: 4,
    subscriptions: 2,
    tokens: 1,
    events: 1,
    expensePeriods: 2,
    expenseRows: 6,
  },
  targetCounts: {
    notes: targetNotes,
    subscriptions: 2,
    tokens: 1,
    events: 1,
    expensePeriods: 1,
    expenseRows: 4,
  },
});

/**
 * Transaction-accounting MergeService double mirroring backend
 * phase5.http.contract.test.ts — used for phase-5 HTTP parity scenarios.
 */
export const createPhase5MergeParityService = (
  transactionStats: MutableMergeTransactionStats,
): MergeService => {
  const runInTransaction = async <T>(operation: () => Promise<T>): Promise<T> => {
    transactionStats.started += 1;

    try {
      const result = await operation();
      transactionStats.committed += 1;
      return result;
    } catch (error) {
      transactionStats.rolledBack += 1;
      throw error;
    }
  };

  return {
    preflight: async (_input: MergePreflightInput) => {
      return await runInTransaction(async () => ({
        summary: createSummary(2),
      }));
    },

    apply: async (input: MergeApplyInput) => {
      return await runInTransaction(async () => {
        if (input.password === "blocked") {
          throw new AppError({
            code: "rate_limit",
            details: {
              retryAfterSeconds: 12,
              resetAt: 1_700_000_012_000,
              internalStack: "omit-me",
            },
          });
        }

        if (input.strategy === "cloud") {
          return {
            strategy: "cloud" as const,
            resolution: "cloud" as const,
            summary: createSummary(2),
          };
        }

        if (input.strategy === "local") {
          return {
            strategy: "local" as const,
            resolution: "local" as const,
            summary: createSummary(4),
          };
        }

        return {
          strategy: "both" as const,
          resolution: "prompt" as const,
          summary: createSummary(5),
        };
      });
    },
  };
};

export const createEmptyMergeTransactionStats = (): MutableMergeTransactionStats => ({
  started: 0,
  committed: 0,
  rolledBack: 0,
});

export type MergeSecurityState = Readonly<{
  failedAttemptsByTarget: Map<string, number>;
  applyInFlightTargets: Set<string>;
  targetNotesByUser: Map<string, number>;
}>;

export const createEmptyMergeSecurityState = (): MergeSecurityState => ({
  failedAttemptsByTarget: new Map(),
  applyInFlightTargets: new Set(),
  targetNotesByUser: new Map(),
});

/**
 * Stateful MergeService double mirroring backend phase5.security-boundary.test.ts —
 * tracks failed auth attempts, concurrent apply guards, and target note counts.
 */
export const createPhase5SecurityMergeService = (
  state: MergeSecurityState,
): MergeService => {
  const toSummary = (toUserId: string) => ({
    sourceEmpty: false,
    sourceSampleOnly: false,
    targetEmpty: false,
    hasConflicts: true,
    sourceCounts: {
      notes: 3,
      subscriptions: 1,
      tokens: 1,
      events: 1,
      expensePeriods: 1,
      expenseRows: 2,
    },
    targetCounts: {
      notes: state.targetNotesByUser.get(toUserId) ?? 1,
      subscriptions: 1,
      tokens: 1,
      events: 1,
      expensePeriods: 0,
      expenseRows: 0,
    },
  });

  const bumpFailedAttempt = (toUserId: string): number => {
    const next = (state.failedAttemptsByTarget.get(toUserId) ?? 0) + 1;
    state.failedAttemptsByTarget.set(toUserId, next);
    return next;
  };

  const resetFailedAttempts = (toUserId: string): void => {
    state.failedAttemptsByTarget.set(toUserId, 0);
  };

  const authorize = (input: MergePreflightInput): void => {
    if (input.password === "correct-password") {
      resetFailedAttempts(input.toUserId);
      return;
    }

    const attempts = bumpFailedAttempt(input.toUserId);
    if (attempts >= 3) {
      throw new AppError({
        code: "rate_limit",
        details: {
          retryAfterSeconds: 60,
          resetAt: 1_800_000_000_000,
          debugStack: "omit-me",
        },
      });
    }

    throw new AppError({ code: "auth" });
  };

  return {
    preflight: async (input: MergePreflightInput) => {
      authorize(input);
      return {
        summary: toSummary(input.toUserId),
      };
    },

    apply: async (input: MergeApplyInput) => {
      authorize(input);

      if (state.applyInFlightTargets.has(input.toUserId)) {
        throw new AppError({ code: "conflict", message: "Merge already in progress" });
      }

      state.applyInFlightTargets.add(input.toUserId);

      try {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 20);
        });

        const currentNotes = state.targetNotesByUser.get(input.toUserId) ?? 1;
        state.targetNotesByUser.set(input.toUserId, currentNotes + 1);
        const resolution: MergeResolution =
          input.strategy === "both" ? "prompt" : input.strategy;

        return {
          strategy: input.strategy,
          resolution,
          summary: toSummary(input.toUserId),
        };
      } finally {
        state.applyInFlightTargets.delete(input.toUserId);
      }
    },
  };
};