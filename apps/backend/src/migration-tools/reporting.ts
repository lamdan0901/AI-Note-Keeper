import { sha256 } from 'js-sha256';

import type { DryRunArtifact, ReconcileReport, ReconcileThresholds, ToolCommand } from './contracts.js';

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
  counts: Readonly<{ source: number; target: number; drift: number }>,
  checksums: Readonly<{ source: string; target: string; mismatch: number }>,
  sampling: Readonly<{ sampled: number; drift: number }>,
  thresholds: ReconcileThresholds,
): ReconcileReport => {
  return {
    counts,
    checksums,
    sampling,
    thresholds,
    pass: evaluateReconcileThresholds(counts.drift, checksums.mismatch, sampling.drift, thresholds),
  };
};
