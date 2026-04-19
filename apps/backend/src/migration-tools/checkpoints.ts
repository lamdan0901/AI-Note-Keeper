import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import type { MigrationCheckpoint, ToolCommand } from './contracts.js';

type CheckpointValidationResult = Readonly<{
  valid: boolean;
  issues: ReadonlyArray<string>;
}>;

const COMMANDS: ReadonlyArray<ToolCommand> = ['export', 'import', 'reconcile'];

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const ensureParentDirectory = async (targetPath: string): Promise<void> => {
  const parent = path.dirname(targetPath);
  if (parent.length === 0 || parent === '.') {
    return;
  }

  await mkdir(parent, { recursive: true });
};

export const validateCheckpoint = (value: unknown): CheckpointValidationResult => {
  const issues: Array<string> = [];

  if (!isRecord(value)) {
    return {
      valid: false,
      issues: ['Checkpoint must be an object.'],
    };
  }

  if (value.version !== 1) {
    issues.push('version must equal 1.');
  }

  if (typeof value.command !== 'string' || !COMMANDS.includes(value.command as ToolCommand)) {
    issues.push('command must be one of export/import/reconcile.');
  }

  if (typeof value.resumeToken !== 'string' || value.resumeToken.length === 0) {
    issues.push('resumeToken is required and must be a non-empty string.');
  }

  if (typeof value.processedRecords !== 'number' || value.processedRecords < 0) {
    issues.push('processedRecords must be a non-negative number.');
  }

  if (value.lastProcessedId !== undefined && typeof value.lastProcessedId !== 'string') {
    issues.push('lastProcessedId must be a string when provided.');
  }

  if (typeof value.updatedAt !== 'string' || Number.isNaN(Date.parse(value.updatedAt))) {
    issues.push('updatedAt must be an ISO-8601 timestamp string.');
  }

  return {
    valid: issues.length === 0,
    issues,
  };
};

export const createCheckpoint = (
  command: ToolCommand,
  resumeToken: string,
  processedRecords: number,
  nowIso: string,
  lastProcessedId?: string,
): MigrationCheckpoint => {
  return {
    version: 1,
    command,
    resumeToken,
    processedRecords,
    updatedAt: nowIso,
    ...(lastProcessedId ? { lastProcessedId } : {}),
  };
};

export const readCheckpointFromFile = async (
  checkpointPath: string,
): Promise<MigrationCheckpoint | null> => {
  try {
    const content = await readFile(checkpointPath, 'utf8');
    return JSON.parse(content) as MigrationCheckpoint;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
};

export const writeCheckpointToFile = async (
  checkpointPath: string,
  checkpoint: MigrationCheckpoint,
): Promise<void> => {
  await ensureParentDirectory(checkpointPath);
  await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2), 'utf8');
};
