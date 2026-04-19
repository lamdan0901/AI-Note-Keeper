import type {
  ExportEntityName,
  ExportRecord,
  ImportBatchInput,
  ImportCommandResult,
  ImportOptions,
  ImportTargetAdapter,
  OrderedExportDataset,
} from '../contracts.js';
import {
  createCheckpoint,
  readCheckpointFromFile,
  validateCheckpoint,
  writeCheckpointToFile,
} from '../checkpoints.js';
import { loadExportArtifact } from '../io/json-artifact.js';
import { createDryRunArtifact } from '../reporting.js';
import { createPostgresImportTarget } from '../targets/postgres-import-target.js';

type ImportRecordEnvelope = Readonly<{
  entity: ExportEntityName;
  record: ExportRecord;
  recordId: string | null;
}>;

type ImportCommandDependencies = Readonly<{
  loadArtifact?: (inputPath: string) => Promise<OrderedExportDataset>;
  targetAdapter?: ImportTargetAdapter;
  nowIso?: () => string;
}>;

const getRecordId = (record: ExportRecord): string | null => {
  const id = record.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
};

const flattenRecords = (dataset: OrderedExportDataset): ReadonlyArray<ImportRecordEnvelope> => {
  const flattened: Array<ImportRecordEnvelope> = [];

  for (const entity of dataset.entityOrder) {
    const records = dataset.entities[entity] ?? [];
    for (const record of records) {
      flattened.push({
        entity,
        record,
        recordId: getRecordId(record),
      });
    }
  }

  return flattened;
};

const groupByEntity = (
  records: ReadonlyArray<ImportRecordEnvelope>,
  dryRun: boolean,
): ReadonlyArray<ImportBatchInput> => {
  const grouped = new Map<ExportEntityName, Array<ExportRecord>>();

  for (const envelope of records) {
    const existing = grouped.get(envelope.entity) ?? [];
    grouped.set(envelope.entity, [...existing, envelope.record]);
  }

  return [...grouped.entries()].map(([entity, entityRecords]) => {
    return {
      entity,
      records: entityRecords,
      dryRun,
    };
  });
};

const resolveResumeOffset = (
  processedRecords: number,
  flattened: ReadonlyArray<ImportRecordEnvelope>,
): number => {
  if (processedRecords <= 0) {
    return 0;
  }

  if (processedRecords >= flattened.length) {
    return flattened.length;
  }

  return processedRecords;
};

export const runImportCommand = async (
  options: ImportOptions,
  dependencies: ImportCommandDependencies = {},
): Promise<ImportCommandResult> => {
  const loadArtifact = dependencies.loadArtifact ?? loadExportArtifact;
  const targetAdapter = dependencies.targetAdapter ?? createPostgresImportTarget();
  const nowIso = dependencies.nowIso ?? (() => new Date().toISOString());

  const orderedArtifact = await loadArtifact(options.inputPath);
  const flattened = flattenRecords(orderedArtifact);

  let processedRecords = 0;
  let lastProcessedId: string | undefined;

  if (options.checkpointPath) {
    const checkpointValue = await readCheckpointFromFile(options.checkpointPath);

    if (checkpointValue) {
      const validation = validateCheckpoint(checkpointValue);
      if (!validation.valid) {
        throw new Error(`Invalid checkpoint schema: ${validation.issues.join('; ')}`);
      }

      if (checkpointValue.command !== 'import') {
        throw new Error('Checkpoint command mismatch: expected import command checkpoint.');
      }

      processedRecords = checkpointValue.processedRecords;
      lastProcessedId = checkpointValue.lastProcessedId;
    }
  }

  let cursor = resolveResumeOffset(processedRecords, flattened);

  while (cursor < flattened.length) {
    const batch = flattened.slice(cursor, cursor + options.batchSize);

    if (!options.dryRun) {
      const groupedBatches = groupByEntity(batch, false);

      for (const groupedBatch of groupedBatches) {
        await targetAdapter.applyBatch(groupedBatch);
      }
    }

    const batchLast = batch[batch.length - 1];
    const batchLastId = batchLast?.recordId ?? undefined;

    processedRecords += batch.length;
    lastProcessedId = batchLastId ?? lastProcessedId;
    cursor += batch.length;

    if (options.checkpointPath) {
      await writeCheckpointToFile(
        options.checkpointPath,
        createCheckpoint('import', `offset:${processedRecords}`, processedRecords, nowIso(), lastProcessedId),
      );
    }
  }

  const artifact = createDryRunArtifact({
    command: 'import',
    generatedAt: orderedArtifact.generatedAt,
    data: {
      batchSize: options.batchSize,
      checkpointPath: options.checkpointPath ?? null,
      inputPath: options.inputPath,
      recordsPlanned: flattened.length,
      processedRecords,
      lastProcessedId: lastProcessedId ?? null,
      resumeToken: `offset:${processedRecords}`,
      entityCounts: orderedArtifact.entityCounts,
    },
  });

  return {
    command: 'import',
    dryRun: artifact,
  };
};
