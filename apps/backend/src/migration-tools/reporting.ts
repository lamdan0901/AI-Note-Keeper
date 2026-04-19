import { sha256 } from 'js-sha256';

import type {
  DryRunArtifact,
  ExportRecord,
  ReconcileEntityMetric,
  ReconcileReport,
  ReconcileThresholds,
  ToolCommand,
} from './contracts.js';

type DryRunInput = Readonly<{
  command: ToolCommand;
  generatedAt: string;
  data: Readonly<Record<string, unknown>>;
}>;

const sortObject = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => sortObject(entry));
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );

    return Object.fromEntries(entries.map(([key, item]) => [key, sortObject(item)]));
  }

  return value;
};

const toStableJson = (value: unknown): string => {
  return JSON.stringify(sortObject(value));
};

export const createDryRunSummary = (
  command: ToolCommand,
  checksum: string,
  data: Readonly<Record<string, unknown>>,
): string => {
  const keys = Object.keys(data).sort();
  const keySummary = keys.length === 0 ? 'none' : keys.join(', ');
  return `${command.toUpperCase()} dry-run :: checksum=${checksum} :: keys=${keySummary}`;
};

export const createDryRunArtifact = (input: DryRunInput): DryRunArtifact => {
  const normalizedData = sortObject(input.data) as Readonly<Record<string, unknown>>;
  const payload = {
    command: input.command,
    data: normalizedData,
    generatedAt: input.generatedAt,
  };

  const checksum = sha256(toStableJson(payload));

  return {
    command: input.command,
    generatedAt: input.generatedAt,
    summary: createDryRunSummary(input.command, checksum, normalizedData),
    data: normalizedData,
    checksum,
  };
};

export const checksumRecords = (records: ReadonlyArray<ExportRecord>): string => {
  return sha256(toStableJson(records));
};

export const calculateSampleDrift = (
  source: ReadonlyArray<ExportRecord>,
  target: ReadonlyArray<ExportRecord>,
): Readonly<{ sampled: number; drift: number }> => {
  const maxLength = Math.max(source.length, target.length);
  if (maxLength === 0) {
    return {
      sampled: 0,
      drift: 0,
    };
  }

  const sampleSize = Math.min(maxLength, 10);
  const step = Math.max(1, Math.floor(maxLength / sampleSize));

  let sampled = 0;
  let drift = 0;

  for (let index = 0; index < maxLength; index += step) {
    const left = source[index] ?? null;
    const right = target[index] ?? null;
    sampled += 1;

    if (toStableJson(left) !== toStableJson(right)) {
      drift += 1;
    }

    if (sampled >= sampleSize) {
      break;
    }
  }

  return {
    sampled,
    drift,
  };
};

export const evaluateReconcileThresholds = (
  countsDrift: number,
  checksumMismatch: number,
  sampleDrift: number,
  thresholds: ReconcileThresholds,
): boolean => {
  return (
    countsDrift <= thresholds.maxCountDrift &&
    checksumMismatch <= thresholds.maxChecksumMismatch &&
    sampleDrift <= thresholds.maxSampleDrift
  );
};

export const createReconcileReport = (
  byEntity: ReadonlyArray<ReconcileEntityMetric>,
  counts: Readonly<{ source: number; target: number; drift: number }>,
  checksums: Readonly<{ source: string; target: string; mismatch: number }>,
  sampling: Readonly<{ sampled: number; drift: number }>,
  thresholds: ReconcileThresholds,
): ReconcileReport => {
  return {
    byEntity,
    counts,
    checksums,
    sampling,
    thresholds,
    pass: evaluateReconcileThresholds(counts.drift, checksums.mismatch, sampling.drift, thresholds),
  };
};
