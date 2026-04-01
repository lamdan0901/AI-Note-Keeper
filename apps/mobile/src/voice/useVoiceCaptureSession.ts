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
  const getNowEpochMs = config.getNowEpochMs ?? Date.now;
  const createSessionId = config.createSessionId ?? createDefaultSessionId;

  let state: VoiceCaptureSessionState = {
    status: 'idle',
    transcript: '',
  };

  let sessionId: string | null = null;
  let lastMappedResult: VoiceDraftMappingResult | null = null;
  let clarificationTurn = 0;

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

  const fail = (error: unknown): void => {
    const normalizedError = toVoiceSessionError(error);
    setState({
      status: 'error',
      transcript: state.transcript,
      error: normalizedError,
    });
    config.onError?.(normalizedError);
  };

  const resolveReview = (mapped: VoiceDraftMappingResult, appendWarnings?: string[]): void => {
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

  const beginHold = async (): Promise<void> => {
    if (!(state.status === 'idle' || state.status === 'review' || state.status === 'error')) {
      return;
    }

    sessionId = createSessionId();
    clarificationTurn = 0;
    lastMappedResult = null;

    setState({ status: 'listening', transcript: '' });

    try {
      await config.speechRecognizer.ensurePermissions();
      await config.speechRecognizer.startListening(
        {
          locale: config.locale ?? undefined,
        },
        {
          onPartialTranscript: (transcript) => {
            const normalizedTranscript = normalizeText(transcript);
            if (!normalizedTranscript) {
              return;
            }

            if (state.status === 'listening') {
              setState({
                status: 'listening',
                transcript: normalizedTranscript,
              });
            }
          },
          onError: (speechError) => {
            fail(speechError);
          },
        },
      );
    } catch (error) {
      fail(error);
    }
  };

  const releaseHold = async (): Promise<void> => {
    if (state.status !== 'listening') {
      return;
    }

    try {
      const transcript = await config.speechRecognizer.stopListening();
      const normalizedTranscript = normalizeText(transcript);

      if (!normalizedTranscript) {
        fail({
          category: 'no-speech',
          message: 'No speech was captured.',
          recoverable: true,
        } satisfies VoiceSessionError);
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

      resolveReview(mapped);
    } catch (error) {
      fail(error);
    }
  };

  const submitClarification = async (answer: string): Promise<void> => {
    if (state.status !== 'clarifying') {
      return;
    }

    if (!lastMappedResult || !sessionId) {
      fail({
        category: 'validation',
        message: 'Missing clarification context.',
        recoverable: true,
      } satisfies VoiceSessionError);
      return;
    }

    const normalizedAnswer = normalizeText(answer);
    if (!normalizedAnswer) {
      fail({
        category: 'validation',
        message: 'Clarification answer cannot be empty.',
        recoverable: true,
      } satisfies VoiceSessionError);
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

        resolveReview(mapped, [
          'Some details are still ambiguous after clarification. Please review before saving.',
        ]);
        return;
      }

      resolveReview(mapped);
    } catch (error) {
      fail(error);
    }
  };

  const cancel = (): void => {
    config.speechRecognizer.cancelListening();
    clarificationTurn = 0;
    lastMappedResult = null;
    sessionId = null;
    setState({
      status: 'idle',
      transcript: '',
    });
  };

  const reset = (): void => {
    clarificationTurn = 0;
    lastMappedResult = null;
    sessionId = null;
    setState({
      status: 'idle',
      transcript: '',
    });
  };

  const dispose = (): void => {
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
