import { describe, expect, it, jest } from '@jest/globals';

const nativeEventEmitterAddListenerMock = jest.fn(() => ({
  remove: jest.fn(),
}));

const nativeEventEmitterConstructorMock = jest.fn(() => ({
  addListener: nativeEventEmitterAddListenerMock,
}));

jest.mock('react-native', () => ({
  Platform: {
    OS: 'android',
  },
  NativeEventEmitter: nativeEventEmitterConstructorMock,
}));

jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {},
}));

import { AndroidSpeechRecognizer } from '../../src/voice/androidSpeechRecognizer';

type AndroidSpeechRecognizerOptions = NonNullable<
  ConstructorParameters<typeof AndroidSpeechRecognizer>[0]
>;

type PermissionResult = {
  granted: boolean;
  canAskAgain: boolean;
};

type SpeechModuleStub = {
  addListener: jest.Mock;
  start: jest.Mock;
  stop: jest.Mock;
  abort: jest.Mock;
  isRecognitionAvailable: jest.Mock<() => boolean>;
  getPermissionsAsync: jest.Mock<() => Promise<PermissionResult>>;
  requestPermissionsAsync: jest.Mock<() => Promise<PermissionResult>>;
};

type EventListeners = Map<string, (...args: unknown[]) => void>;

function createEventHarness(): {
  listeners: EventListeners;
  eventEmitter: AndroidSpeechRecognizerOptions['eventEmitter'];
} {
  const listeners: EventListeners = new Map<string, (...args: unknown[]) => void>();
  const eventEmitter = {
    addListener: jest.fn((eventName: string, listener: (...args: unknown[]) => void) => {
      listeners.set(eventName, listener);
      return { remove: jest.fn() };
    }),
  } as unknown as AndroidSpeechRecognizerOptions['eventEmitter'];

  return {
    listeners,
    eventEmitter,
  };
}

function createSpeechModuleStub(options?: {
  isRecognitionAvailable?: boolean;
  currentPermissions?: PermissionResult;
  requestedPermissions?: PermissionResult;
}): SpeechModuleStub {
  const currentPermissions = options?.currentPermissions ?? {
    granted: true,
    canAskAgain: true,
  };

  const requestedPermissions = options?.requestedPermissions ?? {
    granted: true,
    canAskAgain: true,
  };

  return {
    addListener: jest.fn(() => {
      throw new Error('module addListener should not be used for JS subscriptions');
    }),
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
    isRecognitionAvailable: jest.fn(() => options?.isRecognitionAvailable ?? true),
    getPermissionsAsync: jest.fn(async () => currentPermissions),
    requestPermissionsAsync: jest.fn(async () => requestedPermissions),
  };
}

describe('AndroidSpeechRecognizer permissions', () => {
  it('starts speech recognition in continuous mode to avoid premature service auto-stop', async () => {
    const speechModule = createSpeechModuleStub();

    const recognizer = new AndroidSpeechRecognizer({
      speechModule: speechModule as unknown as AndroidSpeechRecognizerOptions['speechModule'],
    });

    await recognizer.startListening(
      {
        locale: 'en-US',
      },
      {
        onPartialTranscript: jest.fn(),
        onError: jest.fn(),
      },
    );

    expect(speechModule.start).toHaveBeenCalledTimes(1);
    expect(speechModule.start.mock.calls[0][0]).toMatchObject({
      continuous: true,
      interimResults: true,
      androidIntent: 'android.speech.action.WEB_SEARCH',
      androidIntentOptions: {
        EXTRA_LANGUAGE_MODEL: 'web_search',
        EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 3000,
        EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 3000,
      },
    });
  });

  it('ignores no-speech native errors before stop is requested', async () => {
    const speechModule = createSpeechModuleStub();
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const onError = jest.fn();

    const recognizer = new AndroidSpeechRecognizer({
      speechModule: speechModule as unknown as AndroidSpeechRecognizerOptions['speechModule'],
      eventEmitter: {
        addListener: jest.fn((eventName: string, listener: (...args: unknown[]) => void) => {
          listeners.set(eventName, listener);
          return { remove: jest.fn() };
        }),
      } as unknown as AndroidSpeechRecognizerOptions['eventEmitter'],
    });

    await recognizer.startListening(
      {
        locale: 'en-US',
      },
      {
        onPartialTranscript: jest.fn(),
        onError,
      },
    );

    const errorListener = listeners.get('error');
    if (!errorListener) {
      throw new Error('Expected error listener to be registered');
    }

    errorListener({ error: 'no-speech', message: 'No speech detected.' });

    expect(onError).not.toHaveBeenCalled();
  });

  it('uses NativeEventEmitter wiring by default when no eventEmitter is injected', async () => {
    nativeEventEmitterConstructorMock.mockClear();
    nativeEventEmitterAddListenerMock.mockClear();

    const speechModule = createSpeechModuleStub({
      currentPermissions: {
        granted: true,
        canAskAgain: true,
      },
    });

    const recognizer = new AndroidSpeechRecognizer({
      speechModule: speechModule as unknown as AndroidSpeechRecognizerOptions['speechModule'],
    });

    await expect(
      recognizer.startListening(
        {
          locale: 'en-US',
        },
        {
          onPartialTranscript: jest.fn(),
          onError: jest.fn(),
        },
      ),
    ).resolves.toBeUndefined();

    expect(nativeEventEmitterConstructorMock).toHaveBeenCalledTimes(1);
    expect(nativeEventEmitterConstructorMock.mock.calls[0]).toEqual([speechModule]);
    expect(nativeEventEmitterAddListenerMock).toHaveBeenCalledTimes(3);
    expect(speechModule.addListener).not.toHaveBeenCalled();
  });

  it('subscribes via injected event emitter, not module.addListener, when starting recognition', async () => {
    const speechModule = createSpeechModuleStub({
      currentPermissions: {
        granted: true,
        canAskAgain: true,
      },
    });

    const eventEmitter = {
      addListener: jest.fn(() => ({
        remove: jest.fn(),
      })),
    };

    const recognizer = new AndroidSpeechRecognizer({
      speechModule: speechModule as unknown as AndroidSpeechRecognizerOptions['speechModule'],
      eventEmitter: eventEmitter as unknown as AndroidSpeechRecognizerOptions['eventEmitter'],
    });

    await expect(
      recognizer.startListening(
        {
          locale: 'en-US',
        },
        {
          onPartialTranscript: jest.fn(),
          onError: jest.fn(),
        },
      ),
    ).resolves.toBeUndefined();

    expect(eventEmitter.addListener).toHaveBeenCalledTimes(3);
    expect(speechModule.addListener).not.toHaveBeenCalled();
  });

  it('attempts microphone permission request before recognizer-availability failure on first run', async () => {
    const speechModule = createSpeechModuleStub({
      isRecognitionAvailable: false,
      currentPermissions: {
        granted: false,
        canAskAgain: true,
      },
      requestedPermissions: {
        granted: true,
        canAskAgain: true,
      },
    });

    const recognizer = new AndroidSpeechRecognizer({
      speechModule: speechModule as unknown as AndroidSpeechRecognizerOptions['speechModule'],
    });

    await expect(recognizer.ensurePermissions()).rejects.toMatchObject({
      category: 'recognizer-unavailable',
      message: 'Speech recognition is unavailable on this device.',
      recoverable: false,
    });
    expect(speechModule.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('requests microphone permission in-app when current permission is denied', async () => {
    const speechModule = createSpeechModuleStub({
      currentPermissions: {
        granted: false,
        canAskAgain: true,
      },
      requestedPermissions: {
        granted: true,
        canAskAgain: true,
      },
    });

    const recognizer = new AndroidSpeechRecognizer({
      speechModule: speechModule as unknown as AndroidSpeechRecognizerOptions['speechModule'],
    });

    await expect(recognizer.ensurePermissions()).resolves.toBeUndefined();
    expect(speechModule.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('returns a permission-denied error when request is denied after in-app prompt attempt', async () => {
    const speechModule = createSpeechModuleStub({
      currentPermissions: {
        granted: false,
        canAskAgain: false,
      },
      requestedPermissions: {
        granted: false,
        canAskAgain: false,
      },
    });

    const recognizer = new AndroidSpeechRecognizer({
      speechModule: speechModule as unknown as AndroidSpeechRecognizerOptions['speechModule'],
    });

    await expect(recognizer.ensurePermissions()).rejects.toMatchObject({
      category: 'permission-denied',
      message: 'Microphone permission is required for voice capture.',
      recoverable: true,
    });
    expect(speechModule.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('fails fast with recognizer-unavailable when permission is already granted', async () => {
    const speechModule = createSpeechModuleStub({
      isRecognitionAvailable: false,
      currentPermissions: {
        granted: true,
        canAskAgain: true,
      },
    });

    const recognizer = new AndroidSpeechRecognizer({
      speechModule: speechModule as unknown as AndroidSpeechRecognizerOptions['speechModule'],
    });

    await expect(recognizer.ensurePermissions()).rejects.toMatchObject({
      category: 'recognizer-unavailable',
      message: 'Speech recognition is unavailable on this device.',
      recoverable: false,
    });
    expect(speechModule.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('returns partial transcript when stop times out before final result', async () => {
    jest.useFakeTimers();

    try {
      const speechModule = createSpeechModuleStub();
      const { listeners, eventEmitter } = createEventHarness();
      const onError = jest.fn();

      const recognizer = new AndroidSpeechRecognizer({
        speechModule: speechModule as unknown as AndroidSpeechRecognizerOptions['speechModule'],
        eventEmitter,
        stopResultTimeoutMs: 120,
        stopGraceMs: 40,
      });

      await recognizer.startListening(
        {
          locale: 'en-US',
        },
        {
          onPartialTranscript: jest.fn(),
          onError,
        },
      );

      const resultListener = listeners.get('result');
      if (!resultListener) {
        throw new Error('Expected result listener to be registered');
      }

      resultListener({
        results: [{ transcript: 'buy milk' }],
        isFinal: false,
      });

      const stopPromise = recognizer.stopListening();
      await jest.advanceTimersByTimeAsync(150);

      await expect(stopPromise).resolves.toBe('buy milk');
      expect(onError).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps waiting for late partial transcript after post-stop no-speech error', async () => {
    jest.useFakeTimers();

    try {
      const speechModule = createSpeechModuleStub();
      const { listeners, eventEmitter } = createEventHarness();
      const onError = jest.fn();

      const recognizer = new AndroidSpeechRecognizer({
        speechModule: speechModule as unknown as AndroidSpeechRecognizerOptions['speechModule'],
        eventEmitter,
        stopResultTimeoutMs: 120,
        stopGraceMs: 40,
      });

      await recognizer.startListening(
        {
          locale: 'en-US',
        },
        {
          onPartialTranscript: jest.fn(),
          onError,
        },
      );

      const errorListener = listeners.get('error');
      const resultListener = listeners.get('result');
      if (!errorListener || !resultListener) {
        throw new Error('Expected error and result listeners to be registered');
      }

      const stopPromise = recognizer.stopListening();

      errorListener({ error: 'no-speech', message: 'No speech detected.' });
      resultListener({
        results: [{ transcript: 'call mom' }],
        isFinal: false,
      });

      await jest.advanceTimersByTimeAsync(150);

      await expect(stopPromise).resolves.toBe('call mom');
      expect(onError).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('recovers transcript that arrives inside grace window after initial stop timeout', async () => {
    jest.useFakeTimers();

    try {
      const speechModule = createSpeechModuleStub();
      const { listeners, eventEmitter } = createEventHarness();
      const onError = jest.fn();

      const recognizer = new AndroidSpeechRecognizer({
        speechModule: speechModule as unknown as AndroidSpeechRecognizerOptions['speechModule'],
        eventEmitter,
        stopResultTimeoutMs: 120,
        stopGraceMs: 40,
      });

      await recognizer.startListening(
        {
          locale: 'en-US',
        },
        {
          onPartialTranscript: jest.fn(),
          onError,
        },
      );

      const resultListener = listeners.get('result');
      if (!resultListener) {
        throw new Error('Expected result listener to be registered');
      }

      const stopPromise = recognizer.stopListening();
      await jest.advanceTimersByTimeAsync(125);

      resultListener({
        results: [{ transcript: 'set reminder for 5 pm' }],
        isFinal: false,
      });

      await jest.advanceTimersByTimeAsync(40);

      await expect(stopPromise).resolves.toBe('set reminder for 5 pm');
      expect(onError).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('still rejects with no-speech when transcript remains empty after stop timeout', async () => {
    jest.useFakeTimers();

    try {
      const speechModule = createSpeechModuleStub();
      const { eventEmitter } = createEventHarness();

      const recognizer = new AndroidSpeechRecognizer({
        speechModule: speechModule as unknown as AndroidSpeechRecognizerOptions['speechModule'],
        eventEmitter,
        stopResultTimeoutMs: 120,
        stopGraceMs: 40,
      });

      const onError = jest.fn();

      await recognizer.startListening(
        {
          locale: 'en-US',
        },
        {
          onPartialTranscript: jest.fn(),
          onError,
        },
      );

      const stopPromise = recognizer.stopListening();
      const rejection = stopPromise.catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(180);

      const error = await rejection;
      expect(error).toMatchObject({
        category: 'no-speech',
        message: 'No speech detected.',
      });
      expect(onError).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
