import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../convex/_generated/api';
import {
  defaultRetryPolicy,
  getRetryDelayMs,
  shouldRetry,
  type RetryPolicy,
} from '../sync/retryPolicy';
import type {
  ContinueVoiceClarificationRequest,
  ParseVoiceNoteIntentRequest,
  VoiceIntentClient,
  VoiceIntentResponseDto,
} from './types';

type VoiceIntentClientOptions = {
  timeoutMs?: number;
  retryPolicy?: RetryPolicy;
  client?: Pick<ConvexHttpClient, 'action'>;
};

const DEFAULT_TIMEOUT_MS = 12_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Voice intent request timed out')), timeoutMs);
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
  return (
    message.includes('timed out') ||
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('temporarily unavailable')
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

function createDefaultClient(): ConvexHttpClient {
  const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error('Missing EXPO_PUBLIC_CONVEX_URL');
  }
  return new ConvexHttpClient(convexUrl);
}

export class ConvexVoiceIntentClient implements VoiceIntentClient {
  private readonly client: Pick<ConvexHttpClient, 'action'>;

  private readonly timeoutMs: number;

  private readonly retryPolicy: RetryPolicy;

  constructor(options?: VoiceIntentClientOptions) {
    this.client = options?.client ?? createDefaultClient();
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryPolicy = options?.retryPolicy ?? defaultRetryPolicy;
  }

  async parseVoiceNoteIntent(
    request: ParseVoiceNoteIntentRequest,
  ): Promise<VoiceIntentResponseDto> {
    return await runWithRetry(
      async () =>
        await this.client.action(api.functions.aiNoteCapture.parseVoiceNoteIntent, {
          ...request,
          locale: request.locale,
        }),
      this.retryPolicy,
      this.timeoutMs,
    );
  }

  async continueVoiceClarification(
    request: ContinueVoiceClarificationRequest,
  ): Promise<VoiceIntentResponseDto> {
    return await runWithRetry(
      async () =>
        await this.client.action(api.functions.aiNoteCapture.continueVoiceClarification, request),
      this.retryPolicy,
      this.timeoutMs,
    );
  }
}
