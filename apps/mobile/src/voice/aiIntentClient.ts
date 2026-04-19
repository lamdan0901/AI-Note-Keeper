import {
  defaultRetryPolicy,
  getRetryDelayMs,
  shouldRetry,
  type RetryPolicy,
} from '../sync/retryPolicy';
import { createDefaultMobileApiClient } from '../api/httpClient';
import type {
  ContinueVoiceClarificationRequest,
  ParseVoiceNoteIntentRequest,
  VoiceIntentClient,
  VoiceIntentResponseDto,
} from './types';

type VoiceIntentClientOptions = {
  timeoutMs?: number;
  retryPolicy?: RetryPolicy;
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
    message.includes('etimedout') ||
    message.includes('500')
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

export class ConvexVoiceIntentClient implements VoiceIntentClient {
  private readonly timeoutMs: number;

  private readonly retryPolicy: RetryPolicy;

  constructor(options?: VoiceIntentClientOptions) {
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryPolicy = options?.retryPolicy ?? defaultRetryPolicy;
  }

  async parseVoiceNoteIntent(
    request: ParseVoiceNoteIntentRequest,
  ): Promise<VoiceIntentResponseDto> {
    const apiClient = createDefaultMobileApiClient();

    return await runWithRetry(
      async () =>
        await apiClient.requestJson<VoiceIntentResponseDto>('/api/ai/parse-voice', {
          method: 'POST',
          body: {
            transcript: request.transcript,
            userId: request.userId,
            timezone: request.timezone,
            nowEpochMs: request.nowEpochMs,
            locale: request.locale,
            sessionId: request.sessionId,
          },
        }),
      this.retryPolicy,
      this.timeoutMs,
    );
  }

  async continueVoiceClarification(
    request: ContinueVoiceClarificationRequest,
  ): Promise<VoiceIntentResponseDto> {
    const apiClient = createDefaultMobileApiClient();

    return await runWithRetry(
      async () =>
        await apiClient.requestJson<VoiceIntentResponseDto>('/api/ai/clarify', {
          method: 'POST',
          body: request,
        }),
      this.retryPolicy,
      this.timeoutMs,
    );
  }
}
