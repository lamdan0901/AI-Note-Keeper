import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorEvent,
  type ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';
import { NativeEventEmitter, Platform } from 'react-native';
import type {
  VoiceErrorCategory,
  VoiceSessionError,
  VoiceSpeechCallbacks,
  VoiceSpeechRecognizer,
  VoiceSpeechStartOptions,
} from './types';

type SpeechListener = {
  remove: () => void;
};

type SpeechModuleLike = {
  start: (options: {
    lang: string;
    interimResults: boolean;
    continuous: boolean;
    maxAlternatives: number;
    addsPunctuation: boolean;
    androidIntent?: string;
    androidIntentOptions?: {
      EXTRA_LANGUAGE_MODEL?: string;
      EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS?: number;
      EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS?: number;
    };
  }) => void;
  stop: () => void;
  abort: () => void;
  isRecognitionAvailable: () => boolean;
  getPermissionsAsync: () => Promise<{ granted: boolean; canAskAgain: boolean }>;
  requestPermissionsAsync: () => Promise<{ granted: boolean; canAskAgain: boolean }>;
};

type DeferredTranscript = {
  promise: Promise<string>;
  resolve: (value: string) => void;
  reject: (reason: unknown) => void;
  settled: boolean;
};

function createDeferredTranscript(): DeferredTranscript {
  let resolve: ((value: string) => void) | null = null;
  let reject: ((reason: unknown) => void) | null = null;

  const deferred: DeferredTranscript = {
    settled: false,
    promise: new Promise<string>((resolvePromise, rejectPromise) => {
      resolve = (value) => {
        if (deferred.settled) {
          return;
        }
        deferred.settled = true;
        resolvePromise(value);
      };
      reject = (reason) => {
        if (deferred.settled) {
          return;
        }
        deferred.settled = true;
        rejectPromise(reason);
      };
    }),
    resolve: (value) => resolve?.(value),
    reject: (reason) => reject?.(reason),
  };

  return deferred;
}

function normalizeTranscript(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function normalizeSpeechError(error: ExpoSpeechRecognitionErrorEvent): VoiceSessionError {
  const map: Record<string, VoiceErrorCategory> = {
    'not-allowed': 'permission-denied',
    'service-not-allowed': 'recognizer-unavailable',
    'language-not-supported': 'recognizer-unavailable',
    'no-speech': 'no-speech',
    'speech-timeout': 'no-speech',
    network: 'network',
    busy: 'recognizer-unavailable',
    'audio-capture': 'recognizer-unavailable',
    client: 'unknown',
    aborted: 'unknown',
    interrupted: 'unknown',
    'bad-grammar': 'validation',
    unknown: 'unknown',
  };

  const category = map[error.error] ?? 'unknown';
  return {
    category,
    message: error.message || 'Speech recognition failed',
    recoverable: category !== 'permission-denied',
    cause: error,
  };
}

function buildSessionError(
  category: VoiceErrorCategory,
  message: string,
  recoverable: boolean,
  cause?: unknown,
): VoiceSessionError {
  return {
    category,
    message,
    recoverable,
    cause,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Speech final result timed out')), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

type AndroidSpeechRecognizerOptions = {
  speechModule?: SpeechModuleLike;
  eventEmitter?: {
    addListener: <EventName extends 'result' | 'error' | 'end'>(
      eventName: EventName,
      listener:
        | ((event: ExpoSpeechRecognitionResultEvent) => void)
        | ((event: ExpoSpeechRecognitionErrorEvent) => void)
        | (() => void),
    ) => SpeechListener;
  };
  stopResultTimeoutMs?: number;
  stopGraceMs?: number;
};

export class AndroidSpeechRecognizer implements VoiceSpeechRecognizer {
  private readonly speechModule: SpeechModuleLike;

  private eventEmitter: {
    addListener: <EventName extends 'result' | 'error' | 'end'>(
      eventName: EventName,
      listener:
        | ((event: ExpoSpeechRecognitionResultEvent) => void)
        | ((event: ExpoSpeechRecognitionErrorEvent) => void)
        | (() => void),
    ) => SpeechListener;
  } | null = null;

  private readonly stopResultTimeoutMs: number;

  private readonly stopGraceMs: number;

  private listeners: SpeechListener[] = [];

  private currentTranscript = '';

  private baseTranscript = '';

  private activeDeferred: DeferredTranscript | null = null;

  private isListening = false;

  private stopRequested = false;

  private startOptions: VoiceSpeechStartOptions | null = null;

  constructor(options?: AndroidSpeechRecognizerOptions) {
    this.speechModule =
      options?.speechModule ?? (ExpoSpeechRecognitionModule as unknown as SpeechModuleLike);
    this.eventEmitter = options?.eventEmitter ?? null;
    this.stopResultTimeoutMs = options?.stopResultTimeoutMs ?? 1800;
    this.stopGraceMs = options?.stopGraceMs ?? 450;
  }

  private getBestEffortTranscript(): string {
    return normalizeTranscript(this.currentTranscript);
  }

  private isVoiceSessionError(error: unknown): error is VoiceSessionError {
    return (
      typeof error === 'object' &&
      error !== null &&
      'category' in error &&
      typeof (error as { category?: unknown }).category === 'string'
    );
  }

  private getEventEmitter(): NonNullable<AndroidSpeechRecognizer['eventEmitter']> {
    if (this.eventEmitter) {
      return this.eventEmitter;
    }

    this.eventEmitter = new NativeEventEmitter(
      this.speechModule as unknown as ConstructorParameters<typeof NativeEventEmitter>[0],
    ) as unknown as NonNullable<AndroidSpeechRecognizer['eventEmitter']>;

    return this.eventEmitter;
  }

  private ensureAndroidPlatform(): void {
    if (Platform.OS !== 'android') {
      throw buildSessionError(
        'unsupported-platform',
        'Voice capture v1 is available on Android only.',
        false,
      );
    }
  }

  private clearListeners(): void {
    for (const listener of this.listeners) {
      listener.remove();
    }
    this.listeners = [];
  }

  async ensurePermissions(): Promise<void> {
    this.ensureAndroidPlatform();

    const currentPermissions = await this.speechModule.getPermissionsAsync();
    if (!currentPermissions.granted) {
      const requestedPermissions = await this.speechModule.requestPermissionsAsync();
      if (!requestedPermissions.granted) {
        throw buildSessionError(
          'permission-denied',
          'Microphone permission is required for voice capture.',
          true,
        );
      }
    }

    if (!this.speechModule.isRecognitionAvailable()) {
      throw buildSessionError(
        'recognizer-unavailable',
        'Speech recognition is unavailable on this device.',
        false,
      );
    }
  }

  private startNativeRecognition(): void {
    if (!this.startOptions) {
      return;
    }

    this.speechModule.start({
      lang: this.startOptions.locale ?? 'en-US',
      interimResults: true,
      continuous: true,
      maxAlternatives: 1,
      addsPunctuation: true,
      androidIntent: 'android.speech.action.WEB_SEARCH',
      androidIntentOptions: {
        EXTRA_LANGUAGE_MODEL: 'web_search',
        EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 3000,
        EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 3000,
      },
    });
  }

  async startListening(
    options: VoiceSpeechStartOptions,
    callbacks: VoiceSpeechCallbacks,
  ): Promise<void> {
    this.ensureAndroidPlatform();

    if (this.isListening) {
      throw buildSessionError('recognizer-unavailable', 'Speech recognizer is busy.', true);
    }

    this.clearListeners();
    this.currentTranscript = '';
    this.baseTranscript = '';
    this.activeDeferred = createDeferredTranscript();
    this.stopRequested = false;
    this.startOptions = options;

    const eventEmitter = this.getEventEmitter();

    this.listeners = [
      eventEmitter.addListener('result', (event: ExpoSpeechRecognitionResultEvent) => {
        const payload = event;
        const sessionTranscript = normalizeTranscript(payload.results[0]?.transcript ?? '');
        if (!sessionTranscript && !this.baseTranscript) {
          return;
        }

        const combined = normalizeTranscript(`${this.baseTranscript} ${sessionTranscript}`);
        this.currentTranscript = combined;
        callbacks.onPartialTranscript(combined);

        if (payload.isFinal) {
          if (this.stopRequested) {
            this.activeDeferred?.resolve(combined);
          } else {
            // Segment is final but user is still holding. Keep it as base.
            this.baseTranscript = combined;
          }
        }
      }),
      eventEmitter.addListener('error', (event: ExpoSpeechRecognitionErrorEvent) => {
        const normalizedError = normalizeSpeechError(event);

        if (!this.stopRequested && normalizedError.category === 'no-speech') {
          // Restart on silence timeout if still holding
          if (this.isListening) {
            this.startNativeRecognition();
          }
          return;
        }

        if (this.stopRequested) {
          if (normalizedError.category === 'no-speech') {
            // Ignore post-stop no-speech noise so late partial/final results can still be captured.
            return;
          }

          // Route non-no-speech stop-time errors through stopListening for a single final outcome.
          this.activeDeferred?.reject(normalizedError);
          return;
        }

        callbacks.onError(normalizedError);
        this.activeDeferred?.reject(normalizedError);
      }),
      eventEmitter.addListener('end', () => {
        if (this.stopRequested && this.currentTranscript) {
          this.activeDeferred?.resolve(this.currentTranscript);
        } else if (this.isListening && !this.stopRequested) {
          // Native service stopped but user is still holding the button. Restart.
          this.startNativeRecognition();
        }
      }),
    ];

    this.startNativeRecognition();

    this.isListening = true;
  }

  async stopListening(): Promise<string> {
    if (!this.isListening || !this.activeDeferred) {
      throw buildSessionError('no-speech', 'Voice capture session is not active.', true);
    }

    this.stopRequested = true;
    this.speechModule.stop();

    try {
      const transcript = await withTimeout(this.activeDeferred.promise, this.stopResultTimeoutMs);
      const normalized = normalizeTranscript(transcript);
      if (!normalized) {
        throw buildSessionError('no-speech', 'No speech detected.', true);
      }
      return normalized;
    } catch (error) {
      const fallbackTranscript = this.getBestEffortTranscript();
      if (fallbackTranscript) {
        return fallbackTranscript;
      }

      if (this.stopGraceMs > 0) {
        try {
          const lateTranscript = await withTimeout(this.activeDeferred.promise, this.stopGraceMs);
          const normalizedLateTranscript = normalizeTranscript(lateTranscript);
          if (normalizedLateTranscript) {
            return normalizedLateTranscript;
          }
        } catch (lateError) {
          const lateFallbackTranscript = this.getBestEffortTranscript();
          if (lateFallbackTranscript) {
            return lateFallbackTranscript;
          }

          if (this.isVoiceSessionError(lateError) && lateError.category !== 'no-speech') {
            throw lateError;
          }
        }
      }

      if (this.isVoiceSessionError(error) && error.category !== 'no-speech') {
        throw error;
      }

      throw buildSessionError('no-speech', 'No speech detected.', true);
    } finally {
      this.isListening = false;
      this.stopRequested = false;
      this.activeDeferred = null;
      this.startOptions = null;
      this.clearListeners();
    }
  }

  cancelListening(): void {
    if (!this.isListening) {
      return;
    }

    this.speechModule.abort();
    this.activeDeferred?.reject(buildSessionError('no-speech', 'Voice capture cancelled.', true));
    this.isListening = false;
    this.stopRequested = false;
    this.activeDeferred = null;
    this.startOptions = null;
    this.clearListeners();
    this.currentTranscript = '';
    this.baseTranscript = '';
  }

  dispose(): void {
    this.cancelListening();
    this.clearListeners();
  }
}
