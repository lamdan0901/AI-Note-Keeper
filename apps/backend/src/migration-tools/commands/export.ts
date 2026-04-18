import type { ExportCommandResult, ExportOptions, NoopAdapter } from '../contracts.js';
import { createDryRunArtifact } from '../reporting.js';

const DEFAULT_GENERATED_AT = '1970-01-01T00:00:00.000Z';

export const createNoopExportAdapter = (): NoopAdapter<ExportOptions, ExportCommandResult> => {
  return {
    execute: async (options) => {
      const artifact = createDryRunArtifact({
        command: 'export',
        generatedAt: DEFAULT_GENERATED_AT,
        data: {
          batchSize: options.batchSize,
          checkpointPath: options.checkpointPath ?? null,
          outputPath: options.outputPath,
          recordsScanned: 0,
        },
      });

      return {
        command: 'export',
        dryRun: artifact,
      };
    },
  };
};

export const runExportCommand = async (
  options: ExportOptions,
  adapter: NoopAdapter<ExportOptions, ExportCommandResult> = createNoopExportAdapter(),
): Promise<ExportCommandResult> => {
  return adapter.execute(options);
};
