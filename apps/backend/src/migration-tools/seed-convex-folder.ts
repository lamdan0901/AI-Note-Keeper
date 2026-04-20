import path from 'node:path';
import { existsSync } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import type {
  ExportEntityName,
  ExportRecord,
  ImportCommandResult,
  ImportOptions,
  OrderedExportDataset,
} from './contracts.js';
import { runImportCommand } from './commands/import.js';
import { createOrderedDataset } from './sources/ordering.js';

export type SeedFromConvexFolderOptions = Readonly<{
  sourceDir: string;
  dryRun: boolean;
  checkpointPath?: string;
  batchSize: number;
}>;

const entityFolderMap: Readonly<Record<ExportEntityName, string>> = {
  users: 'users',
  notes: 'notes',
  noteChangeEvents: 'noteChangeEvents',
  subscriptions: 'subscriptions',
  devicePushTokens: 'devicePushTokens',
  cronState: 'cronState',
  migrationAttempts: 'migrationAttempts',
  refreshTokens: 'refreshTokens',
};

const MISSING_USER_ID = 'migration-missing-user';
const PLACEHOLDER_PASSWORD_HASH = 'migration-placeholder-password-hash';

type AdditionalLegacyEntities = Readonly<{
  reminders: ReadonlyArray<ExportRecord>;
  reminderChangeEvents: ReadonlyArray<ExportRecord>;
}>;

const hasFlag = (args: ReadonlyArray<string>, flag: string): boolean => {
  return args.includes(flag);
};

const readValue = (args: ReadonlyArray<string>, flag: string): string | undefined => {
  const index = args.indexOf(flag);
  if (index < 0) {
    return undefined;
  }

  if (index + 1 >= args.length) {
    throw new Error(`${flag} requires a value.`);
  }

  const nextValue = args[index + 1];
  if (nextValue.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }

  return nextValue;
};

const parsePositiveInt = (
  value: string | undefined,
  fieldName: string,
  fallback: number,
): number => {
  if (!value) {
    return fallback;
  }

  if (!/^\d+$/u.test(value)) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return parsed;
};

const parseBoolean = (value: string | undefined): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value === 'true' || value === '1') {
    return true;
  }

  if (value === 'false' || value === '0') {
    return false;
  }

  throw new Error(`Boolean flag value "${value}" is invalid. Use true/false or 1/0.`);
};

const normalizeStringOption = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  if (value === 'true' || value === 'false') {
    return undefined;
  }

  return value;
};

const normalizeNumericOption = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  if (value === 'true' || value === 'false') {
    return undefined;
  }

  return value;
};

const collectPositionalValues = (args: ReadonlyArray<string>): ReadonlyArray<string> => {
  const valueFlags: ReadonlyArray<string> = ['--source-dir', '--checkpoint', '--batch-size'];
  const consumedIndexes = new Set<number>();

  for (const flag of valueFlags) {
    const index = args.indexOf(flag);
    if (index < 0) {
      continue;
    }

    consumedIndexes.add(index);
    const value = readValue(args, flag);
    if (value) {
      consumedIndexes.add(index + 1);
    }
  }

  return args.filter((argument, index) => {
    return !consumedIndexes.has(index) && !argument.startsWith('--');
  });
};

const resolveDefaultSourceDir = (): string => {
  const localExportDir = 'old-convex-db';
  const repoRootExportDir = '../../old-convex-db';

  if (existsSync(path.resolve(localExportDir))) {
    return localExportDir;
  }

  if (existsSync(path.resolve(repoRootExportDir))) {
    return repoRootExportDir;
  }

  return localExportDir;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const stringField = (record: ExportRecord, ...keys: ReadonlyArray<string>): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return undefined;
};

const resolvedRecordId = (record: ExportRecord): string | undefined => {
  return stringField(record, 'id', '_id');
};

const resolvedUserId = (record: ExportRecord): string => {
  return stringField(record, 'userId', 'user_id') ?? MISSING_USER_ID;
};

const normalizedUser = (record: ExportRecord): ExportRecord | null => {
  const id = resolvedRecordId(record);
  if (!id) {
    return null;
  }

  return {
    ...record,
    id,
  };
};

const normalizedNote = (record: ExportRecord): ExportRecord | null => {
  const id = resolvedRecordId(record);
  if (!id) {
    return null;
  }

  const userId = resolvedUserId(record);

  return {
    ...record,
    id,
    userId,
    user_id: userId,
  };
};

const normalizedNoteChangeEvent = (record: ExportRecord): ExportRecord | null => {
  const id = resolvedRecordId(record);
  const noteId = stringField(record, 'noteId', 'note_id');
  if (!id || !noteId) {
    return null;
  }

  const userId = resolvedUserId(record);

  return {
    ...record,
    id,
    noteId,
    note_id: noteId,
    userId,
    user_id: userId,
  };
};

const normalizedUserScopedRecord = (record: ExportRecord): ExportRecord | null => {
  const id = resolvedRecordId(record);
  if (!id) {
    return null;
  }

  const userId = resolvedUserId(record);

  return {
    ...record,
    id,
    userId,
    user_id: userId,
  };
};

const normalizedMigrationAttempt = (record: ExportRecord): ExportRecord | null => {
  const id = resolvedRecordId(record);
  if (!id) {
    return null;
  }

  return {
    ...record,
    id,
  };
};

const normalizeWith = (
  records: ReadonlyArray<ExportRecord>,
  normalizer: (record: ExportRecord) => ExportRecord | null,
): ReadonlyArray<ExportRecord> => {
  return records
    .map((record) => normalizer(record))
    .filter((record): record is ExportRecord => record !== null);
};

const mergeDefinedValues = (base: ExportRecord, overlay: ExportRecord): ExportRecord => {
  const merged: Record<string, unknown> = { ...base };
  const existingOwner = stringField(base, 'userId', 'user_id');

  for (const [key, value] of Object.entries(overlay)) {
    if (
      (key === 'userId' || key === 'user_id') &&
      value === MISSING_USER_ID &&
      typeof existingOwner === 'string'
    ) {
      continue;
    }

    if (value !== undefined && value !== null) {
      merged[key] = value;
    }
  }

  return merged;
};

const noteLookupById = (
  notes: ReadonlyArray<ExportRecord>,
): ReadonlyMap<string, ExportRecord> => {
  const mapped = new Map<string, ExportRecord>();

  for (const note of notes) {
    const id = stringField(note, 'id');
    if (!id) {
      continue;
    }

    mapped.set(id, note);
  }

  return mapped;
};

const normalizedReminderAsNote = (
  record: ExportRecord,
  linkedNotes: ReadonlyMap<string, ExportRecord>,
): ExportRecord | null => {
  const id = resolvedRecordId(record);
  if (!id) {
    return null;
  }

  const userId = resolvedUserId(record);
  const linkedNoteId = stringField(record, 'noteId', 'note_id');
  const linkedNote = linkedNoteId ? linkedNotes.get(linkedNoteId) : undefined;

  return {
    ...record,
    id,
    userId,
    user_id: userId,
    title: stringField(record, 'title') ?? stringField(linkedNote ?? {}, 'title') ?? null,
    content: stringField(record, 'content') ?? stringField(linkedNote ?? {}, 'content') ?? null,
    contentType:
      stringField(record, 'contentType', 'content_type') ??
      stringField(linkedNote ?? {}, 'contentType', 'content_type') ??
      null,
    color: stringField(record, 'color') ?? stringField(linkedNote ?? {}, 'color') ?? null,
  };
};

const normalizeReminderChangeEvent = (record: ExportRecord): ExportRecord | null => {
  const id = resolvedRecordId(record);
  const reminderId = stringField(record, 'reminderId', 'noteId', 'note_id');
  if (!id || !reminderId) {
    return null;
  }

  const userId = resolvedUserId(record);

  return {
    ...record,
    id,
    noteId: reminderId,
    note_id: reminderId,
    userId,
    user_id: userId,
  };
};

const mergeNotesWithReminders = (
  notes: ReadonlyArray<ExportRecord>,
  reminders: ReadonlyArray<ExportRecord>,
): ReadonlyArray<ExportRecord> => {
  const mergedNotes = [...notes];

  for (const reminderNote of reminders) {
    const id = stringField(reminderNote, 'id');
    if (!id) {
      continue;
    }

    let foundMatch = false;
    for (let index = 0; index < mergedNotes.length; index += 1) {
      const noteId = stringField(mergedNotes[index], 'id');
      if (noteId === id) {
        mergedNotes[index] = mergeDefinedValues(mergedNotes[index], reminderNote);
        foundMatch = true;
      }
    }

    if (!foundMatch) {
      mergedNotes.push(reminderNote);
    }
  }

  return mergedNotes;
};

const mergeNoteEvents = (
  events: ReadonlyArray<ExportRecord>,
  reminderEvents: ReadonlyArray<ExportRecord>,
): ReadonlyArray<ExportRecord> => {
  const mergedEvents = [...events];
  const existingEventIds = new Set(
    mergedEvents
      .map((event) => stringField(event, 'id'))
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );

  for (const reminderEvent of reminderEvents) {
    const id = stringField(reminderEvent, 'id');
    if (!id || existingEventIds.has(id)) {
      continue;
    }

    mergedEvents.push(reminderEvent);
    existingEventIds.add(id);
  }

  return mergedEvents;
};

const placeholderNoteFromEvent = (event: ExportRecord): ExportRecord => {
  const noteId = stringField(event, 'noteId', 'note_id');
  const changedAt = event.changedAt ?? event.changed_at ?? null;
  const userId = resolvedUserId(event);

  if (!noteId) {
    throw new Error('Cannot build placeholder note: event noteId is required.');
  }

  return {
    id: noteId,
    userId,
    user_id: userId,
    title: '',
    content: '',
    active: false,
    createdAt: changedAt,
    updatedAt: changedAt,
  };
};

const ensureNotesForEvents = (
  notes: ReadonlyArray<ExportRecord>,
  events: ReadonlyArray<ExportRecord>,
): ReadonlyArray<ExportRecord> => {
  const existingNoteIds = new Set(
    notes
      .map((note) => stringField(note, 'id'))
      .filter((noteId): noteId is string => typeof noteId === 'string' && noteId.length > 0),
  );
  const placeholderNotes = new Map<string, ExportRecord>();

  for (const event of events) {
    const noteId = stringField(event, 'noteId', 'note_id');
    if (!noteId || existingNoteIds.has(noteId) || placeholderNotes.has(noteId)) {
      continue;
    }

    placeholderNotes.set(noteId, placeholderNoteFromEvent(event));
  }

  return [...notes, ...placeholderNotes.values()];
};

const collectReferencedUserIds = (
  entities: Readonly<{
    notes: ReadonlyArray<ExportRecord>;
    noteChangeEvents: ReadonlyArray<ExportRecord>;
    subscriptions: ReadonlyArray<ExportRecord>;
    devicePushTokens: ReadonlyArray<ExportRecord>;
    refreshTokens: ReadonlyArray<ExportRecord>;
  }>,
): ReadonlySet<string> => {
  const userIds = new Set<string>();

  const ingest = (records: ReadonlyArray<ExportRecord>): void => {
    for (const record of records) {
      const userId = resolvedUserId(record);
      userIds.add(userId);
    }
  };

  ingest(entities.notes);
  ingest(entities.noteChangeEvents);
  ingest(entities.subscriptions);
  ingest(entities.devicePushTokens);
  ingest(entities.refreshTokens);

  return userIds;
};

const withPlaceholderUsers = (
  users: ReadonlyArray<ExportRecord>,
  referencedUserIds: ReadonlySet<string>,
): ReadonlyArray<ExportRecord> => {
  const existingUserIds = new Set(
    users
      .map((user) => stringField(user, 'id'))
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );

  const placeholders = [...referencedUserIds]
    .filter((userId) => !existingUserIds.has(userId))
    .map((userId) => {
      return {
        id: userId,
        username: `migrated-${userId}`,
        passwordHash: PLACEHOLDER_PASSWORD_HASH,
      } satisfies ExportRecord;
    });

  return [...users, ...placeholders];
};

const normalizeEntitiesForImport = (
  rawEntities: Readonly<Record<ExportEntityName, ReadonlyArray<ExportRecord>>>,
  additional: AdditionalLegacyEntities,
): Readonly<Record<ExportEntityName, ReadonlyArray<ExportRecord>>> => {
  const notes = normalizeWith(rawEntities.notes, normalizedNote);
  const linkedNotes = noteLookupById(notes);
  const reminderNotes = normalizeWith(additional.reminders, (record) =>
    normalizedReminderAsNote(record, linkedNotes),
  );
  const mergedNotes = mergeNotesWithReminders(notes, reminderNotes);

  const noteChangeEvents = normalizeWith(rawEntities.noteChangeEvents, normalizedNoteChangeEvent);
  const reminderChangeEvents = normalizeWith(
    additional.reminderChangeEvents,
    normalizeReminderChangeEvent,
  );
  const mergedEvents = mergeNoteEvents(noteChangeEvents, reminderChangeEvents);
  const notesWithEventParents = ensureNotesForEvents(mergedNotes, mergedEvents);

  const subscriptions = normalizeWith(rawEntities.subscriptions, normalizedUserScopedRecord);
  const devicePushTokens = normalizeWith(rawEntities.devicePushTokens, normalizedUserScopedRecord);
  const refreshTokens = normalizeWith(rawEntities.refreshTokens, normalizedUserScopedRecord);

  const referencedUserIds = collectReferencedUserIds({
    notes: notesWithEventParents,
    noteChangeEvents: mergedEvents,
    subscriptions,
    devicePushTokens,
    refreshTokens,
  });

  const users = withPlaceholderUsers(
    normalizeWith(rawEntities.users, normalizedUser),
    referencedUserIds,
  );

  return {
    users,
    notes: notesWithEventParents,
    noteChangeEvents: mergedEvents,
    subscriptions,
    devicePushTokens,
    cronState: rawEntities.cronState,
    migrationAttempts: normalizeWith(rawEntities.migrationAttempts, normalizedMigrationAttempt),
    refreshTokens,
  };
};

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const normalizeConvexRecord = (record: Record<string, unknown>): ExportRecord => {
  const normalizedId = typeof record.id === 'string' ? record.id : undefined;
  const convexDocumentId = typeof record._id === 'string' ? record._id : undefined;

  return {
    ...record,
    ...(normalizedId ? {} : convexDocumentId ? { id: convexDocumentId } : {}),
  };
};

const readJsonlRecords = async (filePath: string): Promise<ReadonlyArray<ExportRecord>> => {
  const exists = await pathExists(filePath);
  if (!exists) {
    return [];
  }

  const content = await readFile(filePath, 'utf8');
  const lines = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.map((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      throw new Error(`Invalid JSON in ${filePath} at line ${index + 1}.`);
    }

    if (!isRecord(parsed)) {
      throw new Error(`Invalid record in ${filePath} at line ${index + 1}: expected object.`);
    }

    return normalizeConvexRecord(parsed);
  });
};

const loadRecordsForEntity = async (
  sourceDir: string,
  entity: ExportEntityName,
): Promise<ReadonlyArray<ExportRecord>> => {
  const folderName = entityFolderMap[entity];
  const documentsPath = path.join(sourceDir, folderName, 'documents.jsonl');
  return readJsonlRecords(documentsPath);
};

export const loadOrderedDatasetFromConvexFolder = async (
  sourceDir: string,
): Promise<OrderedExportDataset> => {
  const cwdResolvedSourceDir = path.resolve(sourceDir);
  const repoResolvedSourceDir = path.resolve(process.cwd(), '..', '..', sourceDir);

  const absoluteSourceDir =
    (await pathExists(cwdResolvedSourceDir)) || cwdResolvedSourceDir === repoResolvedSourceDir
      ? cwdResolvedSourceDir
      : repoResolvedSourceDir;
  const folderExists = await pathExists(absoluteSourceDir);
  if (!folderExists) {
    throw new Error(`Convex export directory not found: ${absoluteSourceDir}`);
  }

  const sourceStat = await stat(absoluteSourceDir);
  if (!sourceStat.isDirectory()) {
    throw new Error(`Convex export path must be a directory: ${absoluteSourceDir}`);
  }

  const requiredEntityPaths = (Object.keys(entityFolderMap) as ReadonlyArray<ExportEntityName>).map(
    (entity) => path.join(absoluteSourceDir, entityFolderMap[entity], 'documents.jsonl'),
  );
  const legacyReminderPaths = [
    path.join(absoluteSourceDir, 'reminders', 'documents.jsonl'),
    path.join(absoluteSourceDir, 'reminderChangeEvents', 'documents.jsonl'),
  ];
  const entityFilePresence = await Promise.all(
    [...requiredEntityPaths, ...legacyReminderPaths].map((entityPath) => pathExists(entityPath)),
  );

  if (!entityFilePresence.some((present) => present)) {
    throw new Error(
      `No Convex documents.jsonl files found in ${absoluteSourceDir}. Expected at least one entity folder with documents.jsonl.`,
    );
  }

  const entries = await Promise.all(
    (Object.keys(entityFolderMap) as ReadonlyArray<ExportEntityName>).map(async (entity) => {
      const records = await loadRecordsForEntity(absoluteSourceDir, entity);
      return [entity, records] as const;
    }),
  );

  const entities = Object.fromEntries(entries) as Record<
    ExportEntityName,
    ReadonlyArray<ExportRecord>
  >;

  const reminders = await readJsonlRecords(path.join(absoluteSourceDir, 'reminders', 'documents.jsonl'));
  const reminderChangeEvents = await readJsonlRecords(
    path.join(absoluteSourceDir, 'reminderChangeEvents', 'documents.jsonl'),
  );

  const normalizedEntities = normalizeEntitiesForImport(entities, {
    reminders,
    reminderChangeEvents,
  });

  return createOrderedDataset({
    generatedAt: new Date().toISOString(),
    resumeToken: null,
    entities: normalizedEntities,
  });
};

export const parseSeedFromConvexFolderOptions = (
  argv: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv = process.env,
): SeedFromConvexFolderOptions => {
  const positionalValues = [...collectPositionalValues(argv)];
  let sourceDir =
    readValue(argv, '--source-dir') ?? normalizeStringOption(env.npm_config_source_dir);
  let checkpointPath =
    readValue(argv, '--checkpoint') ?? normalizeStringOption(env.npm_config_checkpoint);
  const dryRunFromEnv = parseBoolean(env.npm_config_dry_run === '' ? undefined : env.npm_config_dry_run);
  let batchSizeValue =
    readValue(argv, '--batch-size') ?? normalizeNumericOption(env.npm_config_batch_size);

  if (!sourceDir && positionalValues.length > 0) {
    sourceDir = positionalValues.shift();
  }

  for (const positionalValue of positionalValues) {
    if (!batchSizeValue && /^\d+$/u.test(positionalValue)) {
      batchSizeValue = positionalValue;
      continue;
    }

    if (!checkpointPath) {
      checkpointPath = positionalValue;
      continue;
    }

    if (!batchSizeValue) {
      batchSizeValue = positionalValue;
    }
  }

  sourceDir ??= resolveDefaultSourceDir();

  return {
    sourceDir,
    dryRun: hasFlag(argv, '--dry-run') || dryRunFromEnv === true,
    checkpointPath,
    batchSize: parsePositiveInt(batchSizeValue, '--batch-size', 1000),
  };
};

export const runSeedFromConvexFolder = async (
  options: SeedFromConvexFolderOptions,
): Promise<ImportCommandResult> => {
  const importOptions: ImportOptions = {
    dryRun: options.dryRun,
    inputPath: options.sourceDir,
    checkpointPath: options.checkpointPath,
    batchSize: options.batchSize,
  };

  return runImportCommand(importOptions, {
    loadArtifact: loadOrderedDatasetFromConvexFolder,
  });
};

const printUsage = (): void => {
  console.log(
    'Usage: node dist/migration-tools/seed-convex-folder.js --source-dir <dir> [--batch-size <n>] [--checkpoint <file>] [--dry-run]',
  );
};

const isMainModule = (): boolean => {
  const argvPath = process.argv[1];
  if (!argvPath) {
    return false;
  }

  return import.meta.url === pathToFileURL(argvPath).href;
};

if (isMainModule()) {
  const args = process.argv.slice(2);
  if (hasFlag(args, '--help')) {
    printUsage();
  } else {
    const options = parseSeedFromConvexFolderOptions(args);

    runSeedFromConvexFolder(options)
      .then((result) => {
        const mode = options.dryRun ? 'dry-run' : 'write';
        console.log(`seed-convex-folder mode=${mode}`);
        console.log(`${result.dryRun.summary} :: checksum=${result.dryRun.checksum}`);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`seed-convex-folder failed: ${message}`);
        process.exitCode = 1;
      });
  }
}
