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
  ensurePermissionsSignal?: Promise<void>;
  ensurePermissionsError?: VoiceSessionError;
  stopError?: VoiceSessionError;
  startSignal?: Promise<void>;
  emitPartialOnStart?: boolean;
};

class FakeSpeechRecognizer implements VoiceSpeechRecognizer {
  private readonly transcript: string;

  private readonly ensurePermissionsError?: VoiceSessionError;

  private readonly ensurePermissionsSignal?: Promise<void>;

  private readonly stopError?: VoiceSessionError;

  private readonly startSignal?: Promise<void>;

  private readonly emitPartialOnStart: boolean;

  private callbacks: VoiceSpeechCallbacks | null = null;

  public readonly cancelListening = jest.fn(() => {
    this.callbacks = null;
  });

  public readonly dispose = jest.fn(() => {
    this.callbacks = null;
  });

  constructor(options?: FakeSpeechOptions) {
    this.transcript = options?.transcript ?? 'draft note transcript';
    this.ensurePermissionsSignal = options?.ensurePermissionsSignal;
    this.ensurePermissionsError = options?.ensurePermissionsError;
    this.stopError = options?.stopError;
    this.startSignal = options?.startSignal;
    this.emitPartialOnStart = options?.emitPartialOnStart ?? true;
  }

  async ensurePermissions(): Promise<void> {
    if (this.ensurePermissionsSignal) {
      await this.ensurePermissionsSignal;
    }

    if (this.ensurePermissionsError) {
      throw this.ensurePermissionsError;
    }
  }

  async startListening(
    _options: VoiceSpeechStartOptions,
    callbacks: VoiceSpeechCallbacks,
  ): Promise<void> {
    if (this.startSignal) {
      await this.startSignal;
    }
    this.callbacks = callbacks;
    if (this.emitPartialOnStart) {
      callbacks.onPartialTranscript(this.transcript);
    }
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

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return {
    promise,
    resolve: (value: T) => {
      resolve?.(value);
    },
  };
}

function buildController(input?: {
  speech?: VoiceSpeechRecognizer;
  intentClient?: VoiceIntentClient;
  maxClarificationTurns?: number;
  silenceAutoStopMs?: number;
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
    silenceAutoStopMs: input?.silenceAutoStopMs,
    maxClarificationTurns: input?.maxClarificationTurns,
    getNowEpochMs: () => 1_800_000_000_000,
    createSessionId: () => 'session-1',
    onOpenReview: input?.onOpenReview,
  });

  return { controller, intentClient, speech };
}

describe('voice capture session controller', () => {
  it('auto-stops and processes after 6 seconds of silence when transcript exists', async () => {
    jest.useFakeTimers();

    try {
      const { controller, intentClient } = buildController({
        silenceAutoStopMs: 6000,
      });

      await controller.beginHold();
      expect(controller.getState().status).toBe('listening');

      await jest.advanceTimersByTimeAsync(6100);

      expect(intentClient.parseVoiceNoteIntent).toHaveBeenCalledTimes(1);
      expect(controller.getState().status).toBe('review');
    } finally {
      jest.useRealTimers();
    }
  });

  it('auto-stops with no-speech error after 6 seconds of silence when transcript is empty', async () => {
    jest.useFakeTimers();

    try {
      const speech = new FakeSpeechRecognizer({
        transcript: '   ',
        emitPartialOnStart: false,
      });
      const { controller } = buildController({
        speech,
        silenceAutoStopMs: 6000,
      });

      await controller.beginHold();
      expect(controller.getState().status).toBe('listening');

      await jest.advanceTimersByTimeAsync(6100);

      const finalState = controller.getState();
      expect(finalState.status).toBe('error');
      if (finalState.status !== 'error') {
        throw new Error('Expected error state when silence auto-stop captures no speech');
      }
      expect(finalState.error.category).toBe('no-speech');
    } finally {
      jest.useRealTimers();
    }
  });

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

  it('ignores late parse results after cancel during processing', async () => {
    const onOpenReview = jest.fn();
    const parseDeferred = createDeferred<VoiceIntentResponseDto>();

    const intentClient: VoiceIntentClient = {
      parseVoiceNoteIntent: jest.fn(async () => parseDeferred.promise),
      continueVoiceClarification: jest.fn(async () => buildIntentResponse()),
    };

    const { controller } = buildController({ intentClient, onOpenReview });

    await controller.beginHold();
    const releasePromise = controller.releaseHold();

    controller.cancel();
    parseDeferred.resolve(buildIntentResponse());

    await releasePromise;

    expect(controller.getState()).toEqual({ status: 'idle', transcript: '' });
    expect(onOpenReview).not.toHaveBeenCalled();
  });

  it('handles release fired before recognizer start resolves', async () => {
    const startDeferred = createDeferred<void>();
    const speech = new FakeSpeechRecognizer({ startSignal: startDeferred.promise });
    const { controller, intentClient } = buildController({ speech });

    const beginPromise = controller.beginHold();
    expect(controller.getState().status).toBe('listening');

    const releasePromise = controller.releaseHold();

    startDeferred.resolve(undefined);
    await beginPromise;
    await releasePromise;

    expect(intentClient.parseVoiceNoteIntent).toHaveBeenCalledTimes(1);
    expect(controller.getState().status).toBe('review');
  });

  it('does not start listening if canceled while permission check is pending', async () => {
    const permissionDeferred = createDeferred<void>();
    const speech = new FakeSpeechRecognizer({
      ensurePermissionsSignal: permissionDeferred.promise,
    });
    const startListeningSpy = jest.spyOn(speech, 'startListening');
    const { controller } = buildController({ speech });

    const beginPromise = controller.beginHold();
    controller.cancel();

    permissionDeferred.resolve(undefined);
    await beginPromise;

    expect(startListeningSpy).not.toHaveBeenCalled();
    expect(controller.getState()).toEqual({ status: 'idle', transcript: '' });
  });

  it('handles release fired while permission check is still pending', async () => {
    const permissionDeferred = createDeferred<void>();
    const speech = new FakeSpeechRecognizer({
      ensurePermissionsSignal: permissionDeferred.promise,
    });
    const { controller, intentClient } = buildController({ speech });

    const beginPromise = controller.beginHold();
    const releasePromise = controller.releaseHold();

    permissionDeferred.resolve(undefined);
    await beginPromise;
    await releasePromise;

    expect(intentClient.parseVoiceNoteIntent).toHaveBeenCalledTimes(1);
    expect(controller.getState().status).toBe('review');
  });

  it('keeps second attempt pending promises intact when first attempt resolves late', async () => {
    const firstEnsureDeferred = createDeferred<void>();
    const secondStartDeferred = createDeferred<void>();

    class SequencedSpeechRecognizer implements VoiceSpeechRecognizer {
      private ensureCalls = 0;

      private startCalls = 0;

      private secondStartResolved = false;

      async ensurePermissions(): Promise<void> {
        this.ensureCalls += 1;
        if (this.ensureCalls === 1) {
          await firstEnsureDeferred.promise;
        }
      }

      async startListening(
        _options: VoiceSpeechStartOptions,
        callbacks: VoiceSpeechCallbacks,
      ): Promise<void> {
        this.startCalls += 1;
        if (this.startCalls === 1) {
          await secondStartDeferred.promise;
          this.secondStartResolved = true;
        }
        callbacks.onPartialTranscript('draft note transcript');
      }

      async stopListening(): Promise<string> {
        if (!this.secondStartResolved) {
          throw new Error('Recognizer stop requested before startListening');
        }
        return 'draft note transcript';
      }

      cancelListening(): void {
        return;
      }

      dispose(): void {
        return;
      }
    }

    const speech = new SequencedSpeechRecognizer();
    const { controller, intentClient } = buildController({ speech });

    const firstBeginPromise = controller.beginHold();
    controller.cancel();

    const secondBeginPromise = controller.beginHold();
    expect(controller.getState().status).toBe('listening');

    firstEnsureDeferred.resolve(undefined);
    await firstBeginPromise;

    const releasePromise = controller.releaseHold();
    await Promise.resolve();

    expect(intentClient.parseVoiceNoteIntent).toHaveBeenCalledTimes(0);

    secondStartDeferred.resolve(undefined);
    await secondBeginPromise;
    await releasePromise;

    expect(intentClient.parseVoiceNoteIntent).toHaveBeenCalledTimes(1);
    expect(controller.getState().status).toBe('review');
  });
});
