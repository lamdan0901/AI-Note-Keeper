import { pathToFileURL } from 'node:url';

import type {
  ExportOptions,
  ImportOptions,
  ReconcileOptions,
  ReconcileThresholds,
  ToolCommandResult,
} from './contracts.js';
import { runExportCommand } from './commands/export.js';
import { runImportCommand } from './commands/import.js';
import { runReconcileCommand } from './commands/reconcile.js';

const toPositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const readValue = (args: ReadonlyArray<string>, flag: string): string | undefined => {
  const index = args.indexOf(flag);

  if (index < 0 || index + 1 >= args.length) {
    return undefined;
  }

  return args[index + 1];
};

const hasFlag = (args: ReadonlyArray<string>, flag: string): boolean => {
  return args.includes(flag);
};

const parseThresholds = (args: ReadonlyArray<string>): ReconcileThresholds => {
  return {
    maxCountDrift: toPositiveInt(readValue(args, '--max-count-drift'), 0),
    maxChecksumMismatch: toPositiveInt(readValue(args, '--max-checksum-mismatch'), 0),
    maxSampleDrift: toPositiveInt(readValue(args, '--max-sample-drift'), 0),
  };
};

const parseExportOptions = (args: ReadonlyArray<string>): ExportOptions => {
  return {
    dryRun: hasFlag(args, '--dry-run'),
    outputPath: readValue(args, '--output') ?? 'migration-export.json',
    checkpointPath: readValue(args, '--checkpoint'),
    batchSize: toPositiveInt(readValue(args, '--batch-size'), 1000),
  };
};

const parseImportOptions = (args: ReadonlyArray<string>): ImportOptions => {
  return {
    dryRun: hasFlag(args, '--dry-run'),
    inputPath: readValue(args, '--input') ?? 'migration-export.json',
    checkpointPath: readValue(args, '--checkpoint'),
    batchSize: toPositiveInt(readValue(args, '--batch-size'), 1000),
  };
};

const parseReconcileOptions = (args: ReadonlyArray<string>): ReconcileOptions => {
  return {
    dryRun: hasFlag(args, '--dry-run'),
    sourcePath: readValue(args, '--source') ?? 'source-export.json',
    targetPath: readValue(args, '--target') ?? 'target-export.json',
    thresholds: parseThresholds(args),
  };
};

export const runMigrationToolCommand = async (
  argv: ReadonlyArray<string>,
): Promise<ToolCommandResult> => {
  const [, , command, ...args] = argv;

  switch (command) {
    case 'export':
      return runExportCommand(parseExportOptions(args));
    case 'import':
      return runImportCommand(parseImportOptions(args));
    case 'reconcile':
      return runReconcileCommand(parseReconcileOptions(args));
    default:
      throw new Error(`Unsupported migration-tools command: ${command ?? 'undefined'}`);
  }
};

const isMainModule = (): boolean => {
  const argvPath = process.argv[1];
  if (!argvPath) {
    return false;
  }

  return import.meta.url === pathToFileURL(argvPath).href;
};

if (isMainModule()) {
  runMigrationToolCommand(process.argv)
    .then((result) => {
      console.log(`${result.dryRun.summary} :: checksum=${result.dryRun.checksum}`);
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`migration-tools failed: ${message}`);
      process.exitCode = 1;
    });
}
