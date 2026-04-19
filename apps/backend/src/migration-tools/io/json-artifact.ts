import { readFile } from 'node:fs/promises';

import type { ExportDataset, ExportEntityName, ExportRecord, OrderedExportDataset } from '../contracts.js';
import { createOrderedDataset } from '../sources/ordering.js';

const requiredEntities: ReadonlyArray<ExportEntityName> = [
  'users',
  'notes',
  'noteChangeEvents',
  'subscriptions',
  'devicePushTokens',
  'cronState',
  'migrationAttempts',
  'refreshTokens',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const readEntityRecords = (
  entitiesValue: unknown,
  entity: ExportEntityName,
): ReadonlyArray<ExportRecord> => {
  if (!isRecord(entitiesValue)) {
    return [];
  }

  const records = entitiesValue[entity];
  if (!Array.isArray(records)) {
    return [];
  }

  return records.filter((record) => isRecord(record)) as ReadonlyArray<ExportRecord>;
};

const toExportDataset = (raw: unknown): ExportDataset => {
  if (!isRecord(raw) || raw.command !== 'export') {
    throw new Error('Import requires an export artifact payload with command="export".');
  }

  const data = raw.data;
  if (!isRecord(data)) {
    throw new Error('Import artifact missing data object.');
  }

  const generatedAt = typeof raw.generatedAt === 'string' ? raw.generatedAt : '1970-01-01T00:00:00.000Z';
  const resumeToken = typeof data.resumeToken === 'string' ? data.resumeToken : null;

  const entities = requiredEntities.reduce<Record<ExportEntityName, ReadonlyArray<ExportRecord>>>(
    (accumulator, entity) => {
      accumulator[entity] = readEntityRecords(data.entities, entity);
      return accumulator;
    },
    {
      users: [],
      notes: [],
      noteChangeEvents: [],
      subscriptions: [],
      devicePushTokens: [],
      cronState: [],
      migrationAttempts: [],
      refreshTokens: [],
    },
  );

  return {
    generatedAt,
    resumeToken,
    entities,
  };
};

export const loadExportArtifact = async (inputPath: string): Promise<OrderedExportDataset> => {
  const content = await readFile(inputPath, 'utf8');
  const parsed = JSON.parse(content) as unknown;

  return createOrderedDataset(toExportDataset(parsed));
};
