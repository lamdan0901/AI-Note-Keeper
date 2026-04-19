import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

import type {
  ExportCommandResult,
  ExportOptions,
  ExportSourceAdapter,
  OrderedExportDataset,
} from '../contracts.js';
import { createDryRunArtifact } from '../reporting.js';
import { createFixtureConvexExportSource } from '../sources/convex-export-source.js';
import { createOrderedDataset } from '../sources/ordering.js';

const ensureParentDirectory = async (targetPath: string): Promise<void> => {
  const parent = path.dirname(targetPath);
  if (parent.length === 0 || parent === '.') {
    return;
  }

  await mkdir(parent, { recursive: true });
};

const createExportData = (
  ordered: OrderedExportDataset,
  options: ExportOptions,
): Readonly<Record<string, unknown>> => {
  const recordsScanned = Object.values(ordered.entityCounts).reduce(
    (total, count) => total + count,
    0,
  );

  return {
    batchSize: options.batchSize,
    checkpointPath: options.checkpointPath ?? null,
    outputPath: options.outputPath,
    recordsScanned,
    resumeToken: ordered.resumeToken,
    entityOrder: ordered.entityOrder,
    entities: ordered.entities,
    entityCounts: ordered.entityCounts,
  };
};

const writeExportArtifacts = async (
  options: ExportOptions,
  result: ExportCommandResult,
): Promise<void> => {
  await ensureParentDirectory(options.outputPath);
  await writeFile(
    options.outputPath,
    JSON.stringify(
      {
        command: result.command,
        generatedAt: result.dryRun.generatedAt,
        checksum: result.dryRun.checksum,
        data: result.dryRun.data,
      },
      null,
      2,
    ),
    'utf8',
  );

  if (options.checkpointPath) {
    await ensureParentDirectory(options.checkpointPath);
    await writeFile(
      options.checkpointPath,
      JSON.stringify(
        {
          version: 1,
          command: 'export',
          resumeToken: String((result.dryRun.data as Record<string, unknown>).resumeToken ?? ''),
          processedRecords: Number((result.dryRun.data as Record<string, unknown>).recordsScanned ?? 0),
          updatedAt: result.dryRun.generatedAt,
        },
        null,
        2,
      ),
      'utf8',
    );
  }
};

export const runExportCommand = async (
  options: ExportOptions,
  sourceAdapter: ExportSourceAdapter = createFixtureConvexExportSource(),
): Promise<ExportCommandResult> => {
  const dataset = await sourceAdapter.loadDataset(options);
  const ordered = createOrderedDataset(dataset);

  const artifact = createDryRunArtifact({
    command: 'export',
    generatedAt: ordered.generatedAt,
    data: createExportData(ordered, options),
  });

  const result: ExportCommandResult = {
    command: 'export',
    dryRun: artifact,
  };

  await writeExportArtifacts(options, result);

  return result;
};
