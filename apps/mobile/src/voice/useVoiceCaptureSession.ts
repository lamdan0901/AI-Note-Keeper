import { useEffect, useMemo, useState } from 'react';
import { mapVoiceIntentDraftToEditor } from './intentDraftMapper';
import type {
  ContinueVoiceClarificationRequest,
  ParseVoiceNoteIntentRequest,
  VoiceCaptureSessionState,
  VoiceDraftMappingResult,
  VoiceIntentClient,
  VoiceSessionError,
  VoiceSpeechRecognizer,
} from './types';

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function createDefaultSessionId(): string {
  const now = Date.now();
  const random = Math.floor(Math.random() * 1_000_000);
  return `voice-${now}-${random}`;
}

function toVoiceSessionError(error: unknown): VoiceSessionError {
  if (
    typeof error === 'object' &&
    error !== null &&
    'category' in error &&
    'message' in error &&
    typeof (error as { category: unknown }).category === 'string' &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    const typed = error as VoiceSessionError;
    return {
      category: typed.category,
      message: typed.message,
      recoverable: typed.recoverable,
      cause: typed.cause,
    };
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('timed out')) {
      return {
        category: 'timeout',
        message: error.message,
        recoverable: true,
        cause: error,
      };
    }
    if (message.includes('network') || message.includes('fetch')) {
      return {
        category: 'network',
        message: error.message,
        recoverable: true,
        cause: error,
      };
    }

    return {
      category: 'unknown',
      message: error.message,
      recoverable: true,
      cause: error,
    };
  }

  return {
    category: 'unknown',
    message: 'Unexpected voice capture error',
    recoverable: true,
    cause: error,
  };
}

type VoiceCaptureSessionControllerConfig = {
  speechRecognizer: VoiceSpeechRecognizer;
  intentClient: VoiceIntentClient;
  userId: string;
  timezone: string;
  locale?: string | null;
  silenceAutoStopMs?: number;
  maxClarificationTurns?: number;
  getNowEpochMs?: () => number;
  createSessionId?: () => string;
  onOpenReview?: (result: VoiceDraftMappingResult) => void;
  onError?: (error: VoiceSessionError) => void;
};

type StateListener = (state: VoiceCaptureSessionState) => void;

export type VoiceCaptureSessionController = {
  getState: () => VoiceCaptureSessionState;
  subscribe: (listener: StateListener) => () => void;
  beginHold: () => Promise<void>;
  releaseHold: () => Promise<void>;
  submitClarification: (answer: string) => Promise<void>;
  cancel: () => void;
  reset: () => void;
  dispose: () => void;
};

export function createVoiceCaptureSessionController(
  config: VoiceCaptureSessionControllerConfig,
): VoiceCaptureSessionController {
  const maxClarificationTurns = config.maxClarificationTurns ?? 2;
  const silenceAutoStopMs = config.silenceAutoStopMs ?? 6000;
  const getNowEpochMs = config.getNowEpochMs ?? Date.now;
  const createSessionId = config.createSessionId ?? createDefaultSessionId;

  let state: VoiceCaptureSessionState = {
    status: 'idle',
    transcript: '',
  };

  let sessionId: string | null = null;
  let lastMappedResult: VoiceDraftMappingResult | null = null;
  let clarificationTurn = 0;
  let activeGeneration = 0;
  let pendingActivationPromise: Promise<void> | null = null;
  let pendingStartPromise: Promise<void> | null = null;
  let silenceAutoStopTimer: ReturnType<typeof setTimeout> | null = null;

  const listeners = new Set<StateListener>();

  const emit = (): void => {
    for (const listener of listeners) {
      listener(state);
    }
  };

  const setState = (nextState: VoiceCaptureSessionState): void => {
    state = nextState;
    emit();
  };

  const clearSilenceAutoStopTimer = (): void => {
    if (!silenceAutoStopTimer) {
      return;
    }
    clearTimeout(silenceAutoStopTimer);
    silenceAutoStopTimer = null;
  };

  const nextGeneration = (): number => {
    activeGeneration += 1;
    return activeGeneration;
  };

  const isActiveGeneration = (generation: number): boolean => {
    return generation === activeGeneration;
  };

  const fail = (error: unknown, generation?: number): void => {
    if (generation !== undefined && !isActiveGeneration(generation)) {
      return;
    }

    clearSilenceAutoStopTimer();

    const normalizedError = toVoiceSessionError(error);
    setState({
      status: 'error',
      transcript: state.transcript,
      error: normalizedError,
    });
    config.onError?.(normalizedError);
  };

  const resolveReview = (
    mapped: VoiceDraftMappingResult,
    appendWarnings?: string[],
    generation?: number,
  ): void => {
    if (generation !== undefined && !isActiveGeneration(generation)) {
      return;
    }

    const warnings = appendWarnings
      ? [...mapped.warnings, ...appendWarnings]
      : [...mapped.warnings];

    const reviewState: VoiceCaptureSessionState = {
      status: 'review',
      transcript: mapped.editorDraft.transcript,
      draft: mapped.editorDraft,
      warnings,
    };

    setState(reviewState);
    config.onOpenReview?.({
      ...mapped,
      warnings,
    });
  };

  async function releaseHold(): Promise<void> {
    if (state.status !== 'listening') {
      return;
    }

    clearSilenceAutoStopTimer();

    const generation = activeGeneration;
    const activationPromise = pendingActivationPromise;

    if (activationPromise) {
      try {
        await activationPromise;
      } catch {
        return;
      }

      if (!isActiveGeneration(generation) || state.status !== 'listening') {
        return;
      }
    }

    const startPromise = pendingStartPromise;

    if (startPromise) {
      try {
        await startPromise;
      } catch {
        return;
      }

      if (!isActiveGeneration(generation) || state.status !== 'listening') {
        return;
      }
    }

    try {
      const transcript = await config.speechRecognizer.stopListening();
      if (!isActiveGeneration(generation) || state.status !== 'listening') {
        return;
      }

      const normalizedTranscript = normalizeText(transcript);

      if (!normalizedTranscript) {
        fail(
          {
            category: 'no-speech',
            message: 'No speech was captured.',
            recoverable: true,
          } satisfies VoiceSessionError,
          generation,
        );
        return;
      }

      setState({
        status: 'processing',
        transcript: normalizedTranscript,
      });

      const request: ParseVoiceNoteIntentRequest = {
        transcript: normalizedTranscript,
        userId: config.userId,
        timezone: config.timezone,
        nowEpochMs: getNowEpochMs(),
        locale: config.locale ?? null,
        sessionId: sessionId ?? createSessionId(),
      };

      const parsed = await config.intentClient.parseVoiceNoteIntent(request);
      if (!isActiveGeneration(generation)) {
        return;
      }

      const mapped = mapVoiceIntentDraftToEditor(parsed, { nowEpochMs: request.nowEpochMs });
      lastMappedResult = mapped;

      if (mapped.clarification.required && mapped.clarification.question) {
        clarificationTurn = 1;
        setState({
          status: 'clarifying',
          transcript: mapped.editorDraft.transcript,
          question: mapped.clarification.question,
          turn: clarificationTurn,
          maxTurns: maxClarificationTurns,
        });
        return;
      }

      resolveReview(mapped, undefined, generation);
    } catch (error) {
      fail(error, generation);
    }
  }

  const scheduleSilenceAutoStop = (generation: number): void => {
    if (silenceAutoStopMs <= 0) {
      return;
    }

    clearSilenceAutoStopTimer();
    silenceAutoStopTimer = setTimeout(() => {
      if (!isActiveGeneration(generation) || state.status !== 'listening') {
        return;
      }
      void releaseHold();
    }, silenceAutoStopMs);
  };

  const beginHold = async (): Promise<void> => {
    if (!(state.status === 'idle' || state.status === 'review' || state.status === 'error')) {
      return;
    }

    const generation = nextGeneration();

    sessionId = createSessionId();
    clarificationTurn = 0;
    lastMappedResult = null;

    setState({ status: 'listening', transcript: '' });
    clearSilenceAutoStopTimer();

    let activationPromise: Promise<void> | null = null;
    let localStartPromise: Promise<void> | null = null;

    try {
      activationPromise = (async () => {
        await config.speechRecognizer.ensurePermissions();

        if (!isActiveGeneration(generation)) {
          return;
        }

        const startPromise = config.speechRecognizer.startListening(
          {
            locale: config.locale ?? undefined,
          },
          {
            onPartialTranscript: (transcript) => {
              if (!isActiveGeneration(generation)) {
                return;
              }

              const normalizedTranscript = normalizeText(transcript);
              if (!normalizedTranscript) {
                return;
              }

              if (state.status === 'listening') {
                setState({
                  status: 'listening',
                  transcript: normalizedTranscript,
                });
                scheduleSilenceAutoStop(generation);
              }
            },
            onError: (speechError) => {
              fail(speechError, generation);
            },
          },
        );
        localStartPromise = startPromise;
        pendingStartPromise = startPromise;
        await startPromise;

        if (!isActiveGeneration(generation)) {
          config.speechRecognizer.cancelListening();
          return;
        }

        scheduleSilenceAutoStop(generation);
      })();

      pendingActivationPromise = activationPromise;
      await activationPromise;
    } catch (error) {
      fail(error, generation);
    } finally {
      if (activationPromise && pendingActivationPromise === activationPromise) {
        pendingActivationPromise = null;
      }
      if (localStartPromise && pendingStartPromise === localStartPromise) {
        pendingStartPromise = null;
      }
    }
  };

  const submitClarification = async (answer: string): Promise<void> => {
    if (state.status !== 'clarifying') {
      return;
    }

    const generation = activeGeneration;

    if (!lastMappedResult || !sessionId) {
      fail(
        {
          category: 'validation',
          message: 'Missing clarification context.',
          recoverable: true,
        } satisfies VoiceSessionError,
        generation,
      );
      return;
    }

    const normalizedAnswer = normalizeText(answer);
    if (!normalizedAnswer) {
      fail(
        {
          category: 'validation',
          message: 'Clarification answer cannot be empty.',
          recoverable: true,
        } satisfies VoiceSessionError,
        generation,
      );
      return;
    }

    setState({
      status: 'processing',
      transcript: state.transcript,
    });

    try {
      const request: ContinueVoiceClarificationRequest = {
        sessionId,
        priorDraft: lastMappedResult.normalized.draft,
        clarificationAnswer: normalizedAnswer,
        timezone: config.timezone,
        nowEpochMs: getNowEpochMs(),
      };

      const continued = await config.intentClient.continueVoiceClarification(request);
      if (!isActiveGeneration(generation)) {
        return;
      }

      const mapped = mapVoiceIntentDraftToEditor(continued, {
        nowEpochMs: request.nowEpochMs,
      });
      lastMappedResult = mapped;

      if (mapped.clarification.required && mapped.clarification.question) {
        const nextTurn = clarificationTurn + 1;
        if (nextTurn <= maxClarificationTurns) {
          clarificationTurn = nextTurn;
          setState({
            status: 'clarifying',
            transcript: mapped.editorDraft.transcript,
            question: mapped.clarification.question,
            turn: clarificationTurn,
            maxTurns: maxClarificationTurns,
          });
          return;
        }

        resolveReview(
          mapped,
          ['Some details are still ambiguous after clarification. Please review before saving.'],
          generation,
        );
        return;
      }

      resolveReview(mapped, undefined, generation);
    } catch (error) {
      fail(error, generation);
    }
  };

  const cancel = (): void => {
    config.speechRecognizer.cancelListening();
    clearSilenceAutoStopTimer();
    pendingActivationPromise = null;
    pendingStartPromise = null;
    nextGeneration();
    clarificationTurn = 0;
    lastMappedResult = null;
    sessionId = null;
    setState({
      status: 'idle',
      transcript: '',
    });
  };

  const reset = (): void => {
    config.speechRecognizer.cancelListening();
    clearSilenceAutoStopTimer();
    pendingActivationPromise = null;
    pendingStartPromise = null;
    nextGeneration();
    clarificationTurn = 0;
    lastMappedResult = null;
    sessionId = null;
    setState({
      status: 'idle',
      transcript: '',
    });
  };

  const dispose = (): void => {
    clearSilenceAutoStopTimer();
    pendingActivationPromise = null;
    pendingStartPromise = null;
    nextGeneration();
    config.speechRecognizer.dispose();
    listeners.clear();
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    beginHold,
    releaseHold,
    submitClarification,
    cancel,
    reset,
    dispose,
  };
}

type UseVoiceCaptureSessionConfig = VoiceCaptureSessionControllerConfig;

export function useVoiceCaptureSession(config: UseVoiceCaptureSessionConfig): {
  state: VoiceCaptureSessionState;
  beginHold: () => Promise<void>;
  releaseHold: () => Promise<void>;
  submitClarification: (answer: string) => Promise<void>;
  cancel: () => void;
  reset: () => void;
} {
  const [state, setState] = useState<VoiceCaptureSessionState>({
    status: 'idle',
    transcript: '',
  });

  const controller = useMemo(() => createVoiceCaptureSessionController(config), [config]);

  useEffect(() => {
    const unsubscribe = controller.subscribe((nextState) => {
      setState(nextState);
    });

    setState(controller.getState());

    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);

  return {
    state,
    beginHold: controller.beginHold,
    releaseHold: controller.releaseHold,
    submitClarification: controller.submitClarification,
    cancel: controller.cancel,
    reset: controller.reset,
  };
}
