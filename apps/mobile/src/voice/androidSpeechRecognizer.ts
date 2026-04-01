import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorEvent,
  type ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';
import { Platform } from 'react-native';
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
  addListener: <EventName extends 'result' | 'error' | 'end'>(
    eventName: EventName,
    listener:
      | ((event: ExpoSpeechRecognitionResultEvent) => void)
      | ((event: ExpoSpeechRecognitionErrorEvent) => void)
      | (() => void),
  ) => SpeechListener;
  start: (options: {
    lang: string;
    interimResults: boolean;
    continuous: boolean;
    maxAlternatives: number;
    addsPunctuation: boolean;
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
  stopResultTimeoutMs?: number;
};

export class AndroidSpeechRecognizer implements VoiceSpeechRecognizer {
  private readonly speechModule: SpeechModuleLike;

  private readonly stopResultTimeoutMs: number;

  private listeners: SpeechListener[] = [];

  private currentTranscript = '';

  private activeDeferred: DeferredTranscript | null = null;

  private isListening = false;

  constructor(options?: AndroidSpeechRecognizerOptions) {
    this.speechModule =
      options?.speechModule ?? (ExpoSpeechRecognitionModule as unknown as SpeechModuleLike);
    this.stopResultTimeoutMs = options?.stopResultTimeoutMs ?? 1800;
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

    if (!this.speechModule.isRecognitionAvailable()) {
      throw buildSessionError(
        'recognizer-unavailable',
        'Speech recognition is unavailable on this device.',
        false,
      );
    }

    const currentPermissions = await this.speechModule.getPermissionsAsync();
    if (currentPermissions.granted) {
      return;
    }

    if (!currentPermissions.canAskAgain) {
      throw buildSessionError(
        'permission-denied',
        'Microphone permission has been denied. Enable it in system settings.',
        true,
      );
    }

    const requestedPermissions = await this.speechModule.requestPermissionsAsync();
    if (!requestedPermissions.granted) {
      throw buildSessionError(
        'permission-denied',
        'Microphone permission is required for voice capture.',
        true,
      );
    }
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
    this.activeDeferred = createDeferredTranscript();

    this.listeners = [
      this.speechModule.addListener('result', (event: ExpoSpeechRecognitionResultEvent) => {
        const payload = event;
        const transcript = normalizeTranscript(payload.results[0]?.transcript ?? '');
        if (!transcript) {
          return;
        }

        this.currentTranscript = transcript;
        callbacks.onPartialTranscript(transcript);

        if (payload.isFinal) {
          this.activeDeferred?.resolve(transcript);
        }
      }),
      this.speechModule.addListener('error', (event: ExpoSpeechRecognitionErrorEvent) => {
        const normalizedError = normalizeSpeechError(event);
        callbacks.onError(normalizedError);
        this.activeDeferred?.reject(normalizedError);
      }),
      this.speechModule.addListener('end', () => {
        if (this.currentTranscript) {
          this.activeDeferred?.resolve(this.currentTranscript);
        }
      }),
    ];

    this.speechModule.start({
      lang: options.locale ?? 'en-US',
      interimResults: true,
      continuous: false,
      maxAlternatives: 1,
      addsPunctuation: true,
    });

    this.isListening = true;
  }

  async stopListening(): Promise<string> {
    if (!this.isListening || !this.activeDeferred) {
      throw buildSessionError('no-speech', 'Voice capture session is not active.', true);
    }

    this.speechModule.stop();

    try {
      const transcript = await withTimeout(this.activeDeferred.promise, this.stopResultTimeoutMs);
      const normalized = normalizeTranscript(transcript);
      if (!normalized) {
        throw buildSessionError('no-speech', 'No speech detected.', true);
      }
      return normalized;
    } catch {
      const fallbackTranscript = normalizeTranscript(this.currentTranscript);
      if (fallbackTranscript) {
        return fallbackTranscript;
      }
      throw buildSessionError('no-speech', 'No speech detected.', true);
    } finally {
      this.isListening = false;
      this.activeDeferred = null;
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
    this.activeDeferred = null;
    this.clearListeners();
    this.currentTranscript = '';
  }

  dispose(): void {
    this.cancelListening();
    this.clearListeners();
  }
}
