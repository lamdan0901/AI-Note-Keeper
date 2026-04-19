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

const toSnapshotDataset = (raw: unknown): ExportDataset => {
  if (!isRecord(raw)) {
    throw new Error('Target snapshot must be a JSON object.');
  }

  const generatedAt =
    typeof raw.generatedAt === 'string' ? raw.generatedAt : '1970-01-01T00:00:00.000Z';

  const entities = requiredEntities.reduce<Record<ExportEntityName, ReadonlyArray<ExportRecord>>>(
    (accumulator, entity) => {
      accumulator[entity] = readEntityRecords(raw.entities, entity);
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
    resumeToken: null,
    entities,
  };
};

export const loadTargetSnapshot = async (targetPath: string): Promise<OrderedExportDataset> => {
  const content = await readFile(targetPath, 'utf8');
  const parsed = JSON.parse(content) as unknown;
  return createOrderedDataset(toSnapshotDataset(parsed));
};
