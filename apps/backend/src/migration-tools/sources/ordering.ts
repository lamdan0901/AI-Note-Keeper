import type {
  ExportDataset,
  ExportEntityName,
  ExportRecord,
  OrderedExportDataset,
} from '../contracts.js';

export const canonicalEntityOrder: ReadonlyArray<ExportEntityName> = [
  'users',
  'notes',
  'noteChangeEvents',
  'subscriptions',
  'devicePushTokens',
  'cronState',
  'migrationAttempts',
  'refreshTokens',
] as const;

const stableValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toString() : '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  return JSON.stringify(value);
};

const sortKeysByEntity: Readonly<Record<ExportEntityName, ReadonlyArray<string>>> = {
  users: ['id', 'username'],
  notes: ['id', 'updatedAt', 'createdAt'],
  noteChangeEvents: ['noteId', 'userId', 'operation', 'payloadHash', 'id'],
  subscriptions: ['id', 'userId', 'serviceName'],
  devicePushTokens: ['id', 'userId', 'deviceId'],
  cronState: ['key'],
  migrationAttempts: ['key', 'id'],
  refreshTokens: ['id', 'userId', 'tokenHash'],
};

const compareByKeys = (
  left: ExportRecord,
  right: ExportRecord,
  keys: ReadonlyArray<string>,
): number => {
  for (const key of keys) {
    const leftValue = stableValue(left[key]);
    const rightValue = stableValue(right[key]);

    if (leftValue < rightValue) {
      return -1;
    }

    if (leftValue > rightValue) {
      return 1;
    }
  }

  return 0;
};

export const sortRecordsForExport = (
  entity: ExportEntityName,
  records: ReadonlyArray<ExportRecord>,
): ReadonlyArray<ExportRecord> => {
  const keys = sortKeysByEntity[entity];
  const sorted = [...records].sort((left, right) => compareByKeys(left, right, keys));
  return sorted;
};

export const createOrderedDataset = (dataset: ExportDataset): OrderedExportDataset => {
  const orderedEntities = canonicalEntityOrder.reduce<
    Record<ExportEntityName, ReadonlyArray<ExportRecord>>
  >(
    (accumulator, entity) => {
      accumulator[entity] = sortRecordsForExport(entity, dataset.entities[entity] ?? []);
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

  const entityCounts = canonicalEntityOrder.reduce<Record<ExportEntityName, number>>(
    (accumulator, entity) => {
      accumulator[entity] = orderedEntities[entity].length;
      return accumulator;
    },
    {
      users: 0,
      notes: 0,
      noteChangeEvents: 0,
      subscriptions: 0,
      devicePushTokens: 0,
      cronState: 0,
      migrationAttempts: 0,
      refreshTokens: 0,
    },
  );

  return {
    generatedAt: dataset.generatedAt,
    resumeToken: dataset.resumeToken,
    entityOrder: canonicalEntityOrder,
    entities: orderedEntities,
    entityCounts,
  };
};
