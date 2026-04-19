export type WorkerRuntimeStatus = 'idle' | 'running' | 'stopped' | 'error';

export type WorkerHealthSnapshot = Readonly<{
  status: WorkerRuntimeStatus;
  details?: Readonly<Record<string, unknown>>;
}>;

export type WorkerAdapter = Readonly<{
  readonly name: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  health: () => Promise<WorkerHealthSnapshot>;
}>;

export type WorkerBootstrap = Readonly<{
  adapterName: string;
  shutdown: () => Promise<void>;
  health: () => Promise<WorkerHealthSnapshot>;
}>;
