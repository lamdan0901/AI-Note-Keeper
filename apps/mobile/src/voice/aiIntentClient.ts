import { createConvexBackendClient } from '../../../../packages/shared/backend/convex';
import type {
  ParseVoiceNoteIntentRequest,
  ContinueVoiceClarificationRequest,
  VoiceIntentResponseDto,
} from '../../../../packages/shared/types/voice';
import {
  defaultRetryPolicy,
  getRetryDelayMs,
  shouldRetry,
  type RetryPolicy,
} from '../sync/retryPolicy';
import type { VoiceIntentClient } from './types';

type VoiceBackend = {
  parseVoiceNoteIntent(data: ParseVoiceNoteIntentRequest): Promise<VoiceIntentResponseDto>;
  continueVoiceClarification(
    data: ContinueVoiceClarificationRequest,
  ): Promise<VoiceIntentResponseDto>;
};

type VoiceIntentClientOptions = {
  timeoutMs?: number;
  retryPolicy?: RetryPolicy;
  backend?: VoiceBackend;
};

const DEFAULT_TIMEOUT_MS = 45_000;
const VOICE_INTENT_TIMEOUT_ERROR_MESSAGE = 'Voice intent request timed out';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(VOICE_INTENT_TIMEOUT_ERROR_MESSAGE)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  const timeoutMessage = VOICE_INTENT_TIMEOUT_ERROR_MESSAGE.toLowerCase();

  if (message.includes(timeoutMessage)) {
    return false;
  }

  return (
    message.includes('timed out') ||
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('temporarily unavailable') ||
    message.includes('econnreset') ||
    message.includes('etimedout')
  );
}

async function runWithRetry<T>(
  task: () => Promise<T>,
  retryPolicy: RetryPolicy,
  timeoutMs: number,
): Promise<T> {
  for (let attempt = 0; attempt <= retryPolicy.maxAttempts; attempt += 1) {
    try {
      return await withTimeout(task(), timeoutMs);
    } catch (error) {
      if (!isRetryableError(error) || !shouldRetry(attempt, retryPolicy)) {
        throw error;
      }

      const delayMs = getRetryDelayMs(attempt, retryPolicy);
      await sleep(delayMs);
    }
  }

  throw new Error('Voice intent request exhausted retries');
}

function createDefaultBackend(): VoiceBackend {
  const client = createConvexBackendClient();
  if (!client) {
    throw new Error('Missing EXPO_PUBLIC_CONVEX_URL');
  }
  return client;
}

export class ConvexVoiceIntentClient implements VoiceIntentClient {
  private readonly backend: VoiceBackend;

  private readonly timeoutMs: number;

  private readonly retryPolicy: RetryPolicy;

  constructor(options?: VoiceIntentClientOptions) {
    this.backend = options?.backend ?? createDefaultBackend();
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryPolicy = options?.retryPolicy ?? defaultRetryPolicy;
  }

  async parseVoiceNoteIntent(
    request: ParseVoiceNoteIntentRequest,
  ): Promise<VoiceIntentResponseDto> {
    return await runWithRetry(
      async () => await this.backend.parseVoiceNoteIntent(request),
      this.retryPolicy,
      this.timeoutMs,
    );
  }

  async continueVoiceClarification(
    request: ContinueVoiceClarificationRequest,
  ): Promise<VoiceIntentResponseDto> {
    return await runWithRetry(
      async () => await this.backend.continueVoiceClarification(request),
      this.retryPolicy,
      this.timeoutMs,
    );
  }
}
