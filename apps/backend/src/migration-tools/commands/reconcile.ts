import type {
  ExportEntityName,
  ReconcileCommandResult,
  ReconcileEntityMetric,
  ReconcileOptions,
  OrderedExportDataset,
} from '../contracts.js';
import { loadExportArtifact } from '../io/json-artifact.js';
import { loadTargetSnapshot } from '../io/postgres-snapshot.js';
import {
  calculateSampleDrift,
  checksumRecords,
  createDryRunArtifact,
  createReconcileReport,
} from '../reporting.js';

type ReconcileDependencies = Readonly<{
  loadSource?: (sourcePath: string) => Promise<OrderedExportDataset>;
  loadTarget?: (targetPath: string) => Promise<OrderedExportDataset>;
}>;

const createEntityMetric = (
  entity: ExportEntityName,
  source: OrderedExportDataset,
  target: OrderedExportDataset,
): ReconcileEntityMetric => {
  const sourceRecords = source.entities[entity] ?? [];
  const targetRecords = target.entities[entity] ?? [];
  const sample = calculateSampleDrift(sourceRecords, targetRecords);

  const sourceChecksum = checksumRecords(sourceRecords);
  const targetChecksum = checksumRecords(targetRecords);

  return {
    entity,
    sourceCount: sourceRecords.length,
    targetCount: targetRecords.length,
    countDrift: Math.abs(sourceRecords.length - targetRecords.length),
    sourceChecksum,
    targetChecksum,
    checksumMismatch: sourceChecksum === targetChecksum ? 0 : 1,
    sampleSize: sample.sampled,
    sampleDrift: sample.drift,
  };
};

const aggregateCounts = (metrics: ReadonlyArray<ReconcileEntityMetric>): Readonly<{
  source: number;
  target: number;
  drift: number;
}> => {
  const source = metrics.reduce((total, metric) => total + metric.sourceCount, 0);
  const target = metrics.reduce((total, metric) => total + metric.targetCount, 0);

  return {
    source,
    target,
    drift: Math.abs(source - target),
  };
};

const aggregateChecksums = (
  source: OrderedExportDataset,
  target: OrderedExportDataset,
  metrics: ReadonlyArray<ReconcileEntityMetric>,
): Readonly<{ source: string; target: string; mismatch: number }> => {
  const sourceChecksum = checksumRecords(
    source.entityOrder.flatMap((entity) => source.entities[entity] ?? []),
  );
  const targetChecksum = checksumRecords(
    target.entityOrder.flatMap((entity) => target.entities[entity] ?? []),
  );

  return {
    source: sourceChecksum,
    target: targetChecksum,
    mismatch: metrics.reduce((total, metric) => total + metric.checksumMismatch, 0),
  };
};

const aggregateSampling = (metrics: ReadonlyArray<ReconcileEntityMetric>): Readonly<{
  sampled: number;
  drift: number;
}> => {
  return {
    sampled: metrics.reduce((total, metric) => total + metric.sampleSize, 0),
    drift: metrics.reduce((total, metric) => total + metric.sampleDrift, 0),
  };
};

export const runReconcileCommand = async (
  options: ReconcileOptions,
  dependencies: ReconcileDependencies = {},
): Promise<ReconcileCommandResult> => {
  const loadSource = dependencies.loadSource ?? loadExportArtifact;
  const loadTarget = dependencies.loadTarget ?? loadTargetSnapshot;

  const sourceDataset = await loadSource(options.sourcePath);
  const targetDataset = await loadTarget(options.targetPath);

  const metrics = sourceDataset.entityOrder.map((entity) => {
    return createEntityMetric(entity, sourceDataset, targetDataset);
  });

  const counts = aggregateCounts(metrics);
  const checksums = aggregateChecksums(sourceDataset, targetDataset, metrics);
  const sampling = aggregateSampling(metrics);

  const report = createReconcileReport(metrics, counts, checksums, sampling, options.thresholds);

  const artifact = createDryRunArtifact({
    command: 'reconcile',
    generatedAt: sourceDataset.generatedAt,
    data: {
      sourcePath: options.sourcePath,
      targetPath: options.targetPath,
      report,
    },
  });

  return {
    command: 'reconcile',
    dryRun: artifact,
    report,
  };
};
