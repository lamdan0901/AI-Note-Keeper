import type {
  NoopAdapter,
  ReconcileCommandResult,
  ReconcileOptions,
  ReconcileThresholds,
} from '../contracts.js';
import { createDryRunArtifact, createReconcileReport } from '../reporting.js';

const DEFAULT_GENERATED_AT = '1970-01-01T00:00:00.000Z';

const createPlaceholderThresholds = (thresholds: ReconcileThresholds): ReconcileThresholds => {
  return {
    maxCountDrift: thresholds.maxCountDrift,
    maxChecksumMismatch: thresholds.maxChecksumMismatch,
    maxSampleDrift: thresholds.maxSampleDrift,
  };
};

export const createNoopReconcileAdapter = (): NoopAdapter<
  ReconcileOptions,
  ReconcileCommandResult
> => {
  return {
    execute: async (options) => {
      const normalizedThresholds = createPlaceholderThresholds(options.thresholds);
      const report = createReconcileReport(
        {
          source: 0,
          target: 0,
          drift: 0,
        },
        {
          source: 'pending',
          target: 'pending',
          mismatch: 0,
        },
        {
          sampled: 0,
          drift: 0,
        },
        normalizedThresholds,
      );

      const artifact = createDryRunArtifact({
        command: 'reconcile',
        generatedAt: DEFAULT_GENERATED_AT,
        data: {
          report,
          sourcePath: options.sourcePath,
          targetPath: options.targetPath,
        },
      });

      return {
        command: 'reconcile',
        dryRun: artifact,
        report,
      };
    },
  };
};

export const runReconcileCommand = async (
  options: ReconcileOptions,
  adapter: NoopAdapter<ReconcileOptions, ReconcileCommandResult> = createNoopReconcileAdapter(),
): Promise<ReconcileCommandResult> => {
  return adapter.execute(options);
};
