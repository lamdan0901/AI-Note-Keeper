import { describe, expect, it, jest } from '@jest/globals';
import type { RetryPolicy } from '../../src/sync/retryPolicy';
import { ConvexVoiceIntentClient } from '../../src/voice/aiIntentClient';
import type {
  ContinueVoiceClarificationRequest,
  ParseVoiceNoteIntentRequest,
  VoiceIntentResponseDto,
} from '../../../../packages/shared/types/voice';

const fixedRequest: ParseVoiceNoteIntentRequest = {
  transcript: 'go jogging at 5 pm',
  userId: 'user-1',
  timezone: 'Asia/Ho_Chi_Minh',
  nowEpochMs: 1_805_005_200_000,
  locale: 'en-US',
  sessionId: 'voice-1',
};

const fixedResponse: VoiceIntentResponseDto = {
  draft: {
    title: 'go jogging',
    content: null,
    reminderAtEpochMs: 1_805_023_200_000,
    repeat: {
      kind: 'daily',
      interval: 1,
    },
    keepTranscriptInContent: false,
    normalizedTranscript: 'go jogging at 5 pm',
  },
  confidence: {
    title: 0.9,
    content: 0,
    reminder: 0.9,
    repeat: 0.9,
  },
  clarification: {
    required: false,
    question: null,
    missingFields: [],
  },
};

const fixedClarificationRequest: ContinueVoiceClarificationRequest = {
  sessionId: 'voice-1',
  priorDraft: fixedResponse.draft,
  clarificationAnswer: 'repeat daily',
  timezone: 'Asia/Ho_Chi_Minh',
  nowEpochMs: 1_805_005_200_000,
};

const fastRetryPolicy: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 10,
  maxDelayMs: 10,
  jitterRatio: 0,
};

type VoiceMethod = (
  req: ParseVoiceNoteIntentRequest | ContinueVoiceClarificationRequest,
) => Promise<VoiceIntentResponseDto>;

describe('ConvexVoiceIntentClient', () => {
  it('returns slow first response without retry when it finishes before timeout', async () => {
    jest.useFakeTimers();

    try {
      let callCount = 0;
      const parseImpl: VoiceMethod = async () => {
        callCount += 1;
        return await new Promise<VoiceIntentResponseDto>((resolve) => {
          setTimeout(() => resolve(fixedResponse), 120);
        });
      };

      const client = new ConvexVoiceIntentClient({
        backend: {
          parseVoiceNoteIntent: parseImpl as never,
          continueVoiceClarification: parseImpl as never,
        },
        timeoutMs: 300,
        retryPolicy: fastRetryPolicy,
      });

      const pending = client.parseVoiceNoteIntent(fixedRequest);
      expect(callCount).toBe(1);

      await jest.advanceTimersByTimeAsync(120);

      await expect(pending).resolves.toEqual(fixedResponse);
      expect(callCount).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not retry when request times out on client side', async () => {
    jest.useFakeTimers();

    try {
      let callCount = 0;
      const parseImpl: VoiceMethod = async () => {
        callCount += 1;
        return await new Promise<VoiceIntentResponseDto>(() => {});
      };

      const client = new ConvexVoiceIntentClient({
        backend: {
          parseVoiceNoteIntent: parseImpl as never,
          continueVoiceClarification: parseImpl as never,
        },
        timeoutMs: 50,
        retryPolicy: fastRetryPolicy,
      });

      const pending = client.parseVoiceNoteIntent(fixedRequest);
      expect(callCount).toBe(1);

      await jest.advanceTimersByTimeAsync(51);
      await expect(pending).rejects.toThrow('Voice intent request timed out');

      await jest.advanceTimersByTimeAsync(200);
      expect(callCount).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('retries transient network failures', async () => {
    jest.useFakeTimers();

    try {
      let callCount = 0;
      const parseImpl: VoiceMethod = async () => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error('Network request failed');
        }
        return fixedResponse;
      };

      const client = new ConvexVoiceIntentClient({
        backend: {
          parseVoiceNoteIntent: parseImpl as never,
          continueVoiceClarification: parseImpl as never,
        },
        timeoutMs: 300,
        retryPolicy: fastRetryPolicy,
      });

      const pending = client.parseVoiceNoteIntent(fixedRequest);
      expect(callCount).toBe(1);

      await jest.advanceTimersByTimeAsync(10);
      await expect(pending).resolves.toEqual(fixedResponse);
      expect(callCount).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not retry client timeout for clarification requests', async () => {
    jest.useFakeTimers();

    try {
      let callCount = 0;
      const clarifyImpl: VoiceMethod = async () => {
        callCount += 1;
        return await new Promise<VoiceIntentResponseDto>(() => {});
      };

      const client = new ConvexVoiceIntentClient({
        backend: {
          parseVoiceNoteIntent: clarifyImpl as never,
          continueVoiceClarification: clarifyImpl as never,
        },
        timeoutMs: 50,
        retryPolicy: fastRetryPolicy,
      });

      const pending = client.continueVoiceClarification(fixedClarificationRequest);
      expect(callCount).toBe(1);

      await jest.advanceTimersByTimeAsync(51);
      await expect(pending).rejects.toThrow('Voice intent request timed out');

      await jest.advanceTimersByTimeAsync(200);
      expect(callCount).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
