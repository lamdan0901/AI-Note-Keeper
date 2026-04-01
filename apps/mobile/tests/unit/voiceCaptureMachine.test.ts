import { describe, expect, it, jest } from '@jest/globals';
import {
  createVoiceCaptureSessionController,
  type VoiceCaptureSessionController,
} from '../../src/voice/useVoiceCaptureSession';
import type {
  VoiceIntentClient,
  VoiceIntentResponseDto,
  VoiceSessionError,
  VoiceSpeechCallbacks,
  VoiceSpeechRecognizer,
  VoiceSpeechStartOptions,
} from '../../src/voice/types';

type FakeSpeechOptions = {
  transcript?: string;
  ensurePermissionsError?: VoiceSessionError;
  stopError?: VoiceSessionError;
};

class FakeSpeechRecognizer implements VoiceSpeechRecognizer {
  private readonly transcript: string;

  private readonly ensurePermissionsError?: VoiceSessionError;

  private readonly stopError?: VoiceSessionError;

  private callbacks: VoiceSpeechCallbacks | null = null;

  public readonly cancelListening = jest.fn(() => {
    this.callbacks = null;
  });

  public readonly dispose = jest.fn(() => {
    this.callbacks = null;
  });

  constructor(options?: FakeSpeechOptions) {
    this.transcript = options?.transcript ?? 'draft note transcript';
    this.ensurePermissionsError = options?.ensurePermissionsError;
    this.stopError = options?.stopError;
  }

  async ensurePermissions(): Promise<void> {
    if (this.ensurePermissionsError) {
      throw this.ensurePermissionsError;
    }
  }

  async startListening(
    _options: VoiceSpeechStartOptions,
    callbacks: VoiceSpeechCallbacks,
  ): Promise<void> {
    this.callbacks = callbacks;
    callbacks.onPartialTranscript(this.transcript);
  }

  async stopListening(): Promise<string> {
    if (this.stopError) {
      throw this.stopError;
    }
    return this.transcript;
  }
}

function buildIntentResponse(overrides?: Partial<VoiceIntentResponseDto>): VoiceIntentResponseDto {
  return {
    draft: {
      title: 'Draft title',
      content: 'Draft content',
      reminderAtEpochMs: null,
      repeat: null,
      keepTranscriptInContent: false,
      normalizedTranscript: 'draft note transcript',
    },
    confidence: {
      title: 0.9,
      content: 0.9,
      reminder: 0,
      repeat: 0,
    },
    clarification: {
      required: false,
      question: null,
      missingFields: [],
    },
    ...overrides,
  };
}

function buildController(input?: {
  speech?: VoiceSpeechRecognizer;
  intentClient?: VoiceIntentClient;
  maxClarificationTurns?: number;
  onOpenReview?: (result: unknown) => void;
}): {
  controller: VoiceCaptureSessionController;
  intentClient: VoiceIntentClient;
  speech: VoiceSpeechRecognizer;
} {
  const speech = input?.speech ?? new FakeSpeechRecognizer();
  const intentClient: VoiceIntentClient =
    input?.intentClient ??
    ({
      parseVoiceNoteIntent: jest.fn(async () => buildIntentResponse()),
      continueVoiceClarification: jest.fn(async () => buildIntentResponse()),
    } satisfies VoiceIntentClient);

  const controller = createVoiceCaptureSessionController({
    speechRecognizer: speech,
    intentClient,
    userId: 'user-1',
    timezone: 'UTC',
    locale: 'en-US',
    maxClarificationTurns: input?.maxClarificationTurns,
    getNowEpochMs: () => 1_800_000_000_000,
    createSessionId: () => 'session-1',
    onOpenReview: input?.onOpenReview,
  });

  return { controller, intentClient, speech };
}

describe('voice capture session controller', () => {
  it('runs hold-to-review flow for parse success', async () => {
    const onOpenReview = jest.fn();
    const { controller, intentClient } = buildController({ onOpenReview });

    await controller.beginHold();
    expect(controller.getState().status).toBe('listening');

    await controller.releaseHold();
    expect(intentClient.parseVoiceNoteIntent).toHaveBeenCalledTimes(1);
    expect(controller.getState().status).toBe('review');
    expect(onOpenReview).toHaveBeenCalledTimes(1);
  });

  it('enforces max clarification turns and falls back to review warning', async () => {
    const intentClient: VoiceIntentClient = {
      parseVoiceNoteIntent: jest.fn(async () =>
        buildIntentResponse({
          clarification: {
            required: true,
            question: 'What exact time?',
            missingFields: ['reminder'],
          },
        }),
      ),
      continueVoiceClarification: jest
        .fn<() => Promise<VoiceIntentResponseDto>>()
        .mockResolvedValueOnce(
          buildIntentResponse({
            clarification: {
              required: true,
              question: 'Should this repeat weekly?',
              missingFields: ['repeat'],
            },
          }),
        )
        .mockResolvedValueOnce(
          buildIntentResponse({
            clarification: {
              required: true,
              question: 'Still ambiguous',
              missingFields: ['reminder'],
            },
          }),
        ),
    };

    const { controller } = buildController({
      intentClient,
      maxClarificationTurns: 2,
    });

    await controller.beginHold();
    await controller.releaseHold();
    expect(controller.getState().status).toBe('clarifying');

    await controller.submitClarification('9 AM');
    const afterFirstAnswer = controller.getState();
    expect(afterFirstAnswer.status).toBe('clarifying');
    if (afterFirstAnswer.status !== 'clarifying') {
      throw new Error('Expected clarifying state after first clarification answer');
    }
    expect(afterFirstAnswer.turn).toBe(2);

    await controller.submitClarification('Weekly');
    const finalState = controller.getState();
    expect(finalState.status).toBe('review');
    if (finalState.status !== 'review') {
      throw new Error('Expected review state after max clarification turns are reached');
    }
    expect(finalState.warnings).toContain(
      'Some details are still ambiguous after clarification. Please review before saving.',
    );
  });

  it('returns to idle when canceled during listening', async () => {
    const { controller, speech } = buildController();
    await controller.beginHold();
    expect(controller.getState().status).toBe('listening');

    controller.cancel();
    expect(speech.cancelListening).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toEqual({ status: 'idle', transcript: '' });
  });

  it('transitions to error on permission denied and timeout failures', async () => {
    const permissionDeniedSpeech = new FakeSpeechRecognizer({
      ensurePermissionsError: {
        category: 'permission-denied',
        message: 'Microphone denied',
        recoverable: true,
      },
    });

    const first = buildController({ speech: permissionDeniedSpeech }).controller;
    await first.beginHold();
    const permissionState = first.getState();
    expect(permissionState.status).toBe('error');
    if (permissionState.status !== 'error') {
      throw new Error('Expected error state for permission failure');
    }
    expect(permissionState.error.category).toBe('permission-denied');

    const timeoutIntentClient: VoiceIntentClient = {
      parseVoiceNoteIntent: jest.fn(async () => {
        throw new Error('Voice intent request timed out');
      }),
      continueVoiceClarification: jest.fn(async () => buildIntentResponse()),
    };

    const second = buildController({ intentClient: timeoutIntentClient }).controller;
    await second.beginHold();
    await second.releaseHold();
    const timeoutState = second.getState();
    expect(timeoutState.status).toBe('error');
    if (timeoutState.status !== 'error') {
      throw new Error('Expected error state for timeout failure');
    }
    expect(timeoutState.error.category).toBe('timeout');
  });
});
