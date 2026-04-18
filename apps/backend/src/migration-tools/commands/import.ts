import type { ImportCommandResult, ImportOptions, NoopAdapter } from '../contracts.js';
import { createDryRunArtifact } from '../reporting.js';

const DEFAULT_GENERATED_AT = '1970-01-01T00:00:00.000Z';

export const createNoopImportAdapter = (): NoopAdapter<ImportOptions, ImportCommandResult> => {
  return {
    execute: async (options) => {
      const artifact = createDryRunArtifact({
        command: 'import',
        generatedAt: DEFAULT_GENERATED_AT,
        data: {
          batchSize: options.batchSize,
          checkpointPath: options.checkpointPath ?? null,
          inputPath: options.inputPath,
          recordsPlanned: 0,
        },
      });

      return {
        command: 'import',
        dryRun: artifact,
      };
    },
  };
};

export const runImportCommand = async (
  options: ImportOptions,
  adapter: NoopAdapter<ImportOptions, ImportCommandResult> = createNoopImportAdapter(),
): Promise<ImportCommandResult> => {
  return adapter.execute(options);
};
