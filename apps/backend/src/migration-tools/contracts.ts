export type ToolCommand = 'export' | 'import' | 'reconcile';

export type ExportEntityName =
  | 'users'
  | 'notes'
  | 'noteChangeEvents'
  | 'subscriptions'
  | 'devicePushTokens'
  | 'cronState'
  | 'migrationAttempts'
  | 'refreshTokens';

export type ExportRecord = Readonly<Record<string, unknown>>;

export type ExportDataset = Readonly<{
  generatedAt: string;
  resumeToken: string | null;
  entities: Readonly<Record<ExportEntityName, ReadonlyArray<ExportRecord>>>;
}>;

export type OrderedExportDataset = Readonly<{
  generatedAt: string;
  resumeToken: string | null;
  entityOrder: ReadonlyArray<ExportEntityName>;
  entities: Readonly<Record<ExportEntityName, ReadonlyArray<ExportRecord>>>;
  entityCounts: Readonly<Record<ExportEntityName, number>>;
}>;

export type ExportArtifactFile = Readonly<{
  command: 'export';
  generatedAt: string;
  checksum: string;
  data: Readonly<Record<string, unknown>>;
}>;

export type DryRunArtifact = Readonly<{
  command: ToolCommand;
  generatedAt: string;
  summary: string;
  data: Readonly<Record<string, unknown>>;
  checksum: string;
}>;

export type ExportOptions = Readonly<{
  dryRun: boolean;
  outputPath: string;
  checkpointPath?: string;
  batchSize: number;
}>;

export type ExportSourceAdapter = Readonly<{
  loadDataset: (options: ExportOptions) => Promise<ExportDataset>;
}>;

export type ImportOptions = Readonly<{
  dryRun: boolean;
  inputPath: string;
  checkpointPath?: string;
  batchSize: number;
}>;

export type ImportBatchInput = Readonly<{
  entity: ExportEntityName;
  records: ReadonlyArray<ExportRecord>;
  dryRun: boolean;
}>;

export type ImportBatchResult = Readonly<{
  processedRecords: number;
  lastProcessedId?: string;
}>;

export type ImportTargetAdapter = Readonly<{
  applyBatch: (input: ImportBatchInput) => Promise<ImportBatchResult>;
}>;

export type ReconcileThresholds = Readonly<{
  maxCountDrift: number;
  maxChecksumMismatch: number;
  maxSampleDrift: number;
}>;

export type ReconcileOptions = Readonly<{
  dryRun: boolean;
  sourcePath: string;
  targetPath: string;
  thresholds: ReconcileThresholds;
}>;

export type ReconcileEntityMetric = Readonly<{
  entity: ExportEntityName;
  sourceCount: number;
  targetCount: number;
  countDrift: number;
  sourceChecksum: string;
  targetChecksum: string;
  checksumMismatch: number;
  sampleSize: number;
  sampleDrift: number;
}>;

export type ExportCommandResult = Readonly<{
  command: 'export';
  dryRun: DryRunArtifact;
}>;

export type ImportCommandResult = Readonly<{
  command: 'import';
  dryRun: DryRunArtifact;
}>;

export type ReconcileReport = Readonly<{
  byEntity: ReadonlyArray<ReconcileEntityMetric>;
  counts: Readonly<{
    source: number;
    target: number;
    drift: number;
  }>;
  checksums: Readonly<{
    source: string;
    target: string;
    mismatch: number;
  }>;
  sampling: Readonly<{
    sampled: number;
    drift: number;
  }>;
  thresholds: ReconcileThresholds;
  pass: boolean;
}>;

export type ReconcileCommandResult = Readonly<{
  command: 'reconcile';
  dryRun: DryRunArtifact;
  report: ReconcileReport;
}>;

export type ToolCommandResult = ExportCommandResult | ImportCommandResult | ReconcileCommandResult;

export type MigrationCheckpoint = Readonly<{
  version: 1;
  command: ToolCommand;
  resumeToken: string;
  processedRecords: number;
  lastProcessedId?: string;
  updatedAt: string;
}>;

export type NoopAdapter<TOptions, TResult> = Readonly<{
  execute: (options: TOptions) => Promise<TResult>;
}>;
