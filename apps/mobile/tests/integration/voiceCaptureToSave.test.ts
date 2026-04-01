import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SQLiteDatabase } from 'expo-sqlite/next';
import { buildCanonicalRecurrenceFields } from '../../../../packages/shared/utils/repeatCodec';

const mockedUpsertNote: jest.Mock = jest.fn(async () => undefined);
const mockedEnqueueNoteOperation: jest.Mock = jest.fn(async () => undefined);
const mockedScheduleNoteReminderNotification: jest.Mock = jest.fn(async () => [
  'local-notification-id',
]);

jest.mock('../../src/db/notesRepo', () => {
  const actual = jest.requireActual('../../src/db/notesRepo') as Record<string, unknown>;
  return {
    ...actual,
    upsertNote: mockedUpsertNote,
  };
});

jest.mock('../../src/sync/noteOutbox', () => ({
  enqueueNoteOperation: mockedEnqueueNoteOperation,
}));

jest.mock('../../src/reminders/scheduleNoteReminder', () => ({
  scheduleNoteReminderNotification: mockedScheduleNoteReminderNotification,
}));

import type { Note } from '../../src/db/notesRepo';
import { saveNoteOffline } from '../../src/notes/editor';
import { createVoiceCaptureSessionController } from '../../src/voice/useVoiceCaptureSession';
import type {
  VoiceIntentClient,
  VoiceIntentResponseDto,
  VoiceSpeechCallbacks,
  VoiceSpeechRecognizer,
  VoiceSpeechStartOptions,
} from '../../src/voice/types';

class FakeSpeechRecognizer implements VoiceSpeechRecognizer {
  public startListeningCalls = 0;

  private callbacks: VoiceSpeechCallbacks | null = null;

  constructor(private readonly transcript: string) {}

  async ensurePermissions(): Promise<void> {
    return;
  }

  async startListening(
    _options: VoiceSpeechStartOptions,
    callbacks: VoiceSpeechCallbacks,
  ): Promise<void> {
    this.startListeningCalls += 1;
    this.callbacks = callbacks;
    callbacks.onPartialTranscript(this.transcript);
  }

  async stopListening(): Promise<string> {
    if (!this.callbacks) {
      throw new Error('Recognizer stop requested before startListening');
    }

    return this.transcript;
  }

  cancelListening(): void {
    this.callbacks = null;
  }

  dispose(): void {
    this.callbacks = null;
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
      normalizedTranscript: 'schedule dentist reminder',
    },
    confidence: {
      title: 0.9,
      content: 0.9,
      reminder: 0.8,
      repeat: 0.8,
    },
    clarification: {
      required: false,
      question: null,
      missingFields: [],
    },
    ...overrides,
  };
}

describe('voice capture to save integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('runs transcript -> parse -> clarification -> review -> save through outbox and reminder scheduling', async () => {
    const transcript = 'remind me to schedule dentist every monday at nine';
    const speechRecognizer = new FakeSpeechRecognizer(transcript);

    const parseResponse = buildIntentResponse({
      draft: {
        title: 'Dentist',
        content: 'Schedule dentist appointment',
        reminderAtEpochMs: null,
        repeat: null,
        keepTranscriptInContent: false,
        normalizedTranscript: transcript,
      },
      clarification: {
        required: true,
        question: 'Should I set this for the next Monday at 9:00?',
        missingFields: ['reminder'],
      },
    });

    const reminderEpochMs = 1_900_000_000_000;

    const clarifiedResponse = buildIntentResponse({
      draft: {
        title: 'Dentist',
        content: 'Schedule dentist appointment',
        reminderAtEpochMs: reminderEpochMs,
        repeat: {
          kind: 'weekly',
          interval: 1,
          weekdays: [1],
        },
        keepTranscriptInContent: false,
        normalizedTranscript: transcript,
      },
      clarification: {
        required: false,
        question: null,
        missingFields: [],
      },
    });

    const intentClient: VoiceIntentClient = {
      parseVoiceNoteIntent: jest.fn(async () => parseResponse),
      continueVoiceClarification: jest.fn(async () => clarifiedResponse),
    };

    const onOpenReview = jest.fn();

    const controller = createVoiceCaptureSessionController({
      speechRecognizer,
      intentClient,
      userId: 'user-1',
      timezone: 'UTC',
      locale: 'en-US',
      getNowEpochMs: () => 1_800_000_000_000,
      createSessionId: () => 'session-voice-1',
      onOpenReview,
    });

    await controller.beginHold();
    expect(controller.getState().status).toBe('listening');

    await controller.releaseHold();

    const clarifyingState = controller.getState();
    expect(clarifyingState.status).toBe('clarifying');
    if (clarifyingState.status !== 'clarifying') {
      throw new Error('Expected clarifying state after initial parse response');
    }
    expect(clarifyingState.question).toContain('next Monday');

    await controller.submitClarification('Yes, next Monday at 9 AM and repeat weekly');

    const reviewState = controller.getState();
    expect(reviewState.status).toBe('review');
    if (reviewState.status !== 'review') {
      throw new Error('Expected review state after clarification response');
    }
    expect(onOpenReview).toHaveBeenCalledTimes(1);

    expect(intentClient.parseVoiceNoteIntent).toHaveBeenCalledTimes(1);
    expect(intentClient.continueVoiceClarification).toHaveBeenCalledTimes(1);
    expect(speechRecognizer.startListeningCalls).toBe(1);

    const parseRequest = (intentClient.parseVoiceNoteIntent as jest.Mock).mock.calls[0]?.[0] as {
      transcript: string;
      sessionId: string;
      userId: string;
      timezone: string;
      locale: string | null;
      nowEpochMs: number;
    };
    expect(parseRequest.transcript).toBe(transcript);
    expect(parseRequest.sessionId).toBe('session-voice-1');
    expect(parseRequest.userId).toBe('user-1');
    expect(parseRequest.timezone).toBe('UTC');
    expect(parseRequest.locale).toBe('en-US');
    expect(parseRequest.nowEpochMs).toBe(1_800_000_000_000);

    const clarificationRequest = (intentClient.continueVoiceClarification as jest.Mock).mock
      .calls[0]?.[0] as {
      sessionId: string;
      clarificationAnswer: string;
      timezone: string;
      nowEpochMs: number;
      priorDraft: {
        reminderAtEpochMs: number | null;
      };
    };
    expect(clarificationRequest.sessionId).toBe('session-voice-1');
    expect(clarificationRequest.clarificationAnswer).toContain('repeat weekly');
    expect(clarificationRequest.timezone).toBe('UTC');
    expect(clarificationRequest.nowEpochMs).toBe(1_800_000_000_000);
    expect(clarificationRequest.priorDraft.reminderAtEpochMs).toBeNull();

    const reviewDraft = reviewState.draft;
    const reminder = reviewDraft.reminder;
    expect(reminder?.getTime()).toBe(reminderEpochMs);
    expect(reviewDraft.repeat).toEqual({
      kind: 'weekly',
      interval: 1,
      weekdays: [1],
    });

    const now = 1_800_000_100_000;
    const noteToSave: Note = {
      id: 'note-voice-1',
      userId: 'user-1',
      title: reviewDraft.title,
      content: reviewDraft.content,
      contentType: undefined,
      color: null,
      active: true,
      done: false,
      isPinned: false,
      triggerAt: reminder?.getTime(),
      snoozedUntil: undefined,
      scheduleStatus: 'unscheduled',
      timezone: 'UTC',
      ...buildCanonicalRecurrenceFields({
        reminderAt: reminder?.getTime() ?? null,
        repeat: reviewDraft.repeat,
      }),
      createdAt: now,
      updatedAt: now,
      serverVersion: 0,
      version: 0,
      syncStatus: undefined,
    };

    const db = {
      runAsync: jest.fn(async () => undefined),
    } as unknown as SQLiteDatabase;

    await saveNoteOffline(db, noteToSave, 'create', 'user-1');

    expect(mockedUpsertNote).toHaveBeenCalledTimes(1);
    expect(mockedUpsertNote).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        id: 'note-voice-1',
        title: 'Dentist',
        content: 'Schedule dentist appointment',
        triggerAt: reminderEpochMs,
        repeatRule: 'weekly',
        repeat: expect.objectContaining({
          kind: 'weekly',
        }),
      }),
    );

    expect(mockedEnqueueNoteOperation).toHaveBeenCalledTimes(1);
    expect(mockedEnqueueNoteOperation).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        id: 'note-voice-1',
        triggerAt: reminderEpochMs,
        repeatRule: 'weekly',
        repeat: expect.objectContaining({
          kind: 'weekly',
        }),
      }),
      'create',
      'user-1',
      expect.any(Number),
    );

    expect(mockedScheduleNoteReminderNotification).toHaveBeenCalledTimes(1);
    expect(mockedScheduleNoteReminderNotification).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        id: 'note-voice-1',
        triggerAt: reminderEpochMs,
      }),
      'user-1',
    );

    const upsertOrder = mockedUpsertNote.mock.invocationCallOrder[0];
    const outboxOrder = mockedEnqueueNoteOperation.mock.invocationCallOrder[0];
    const reminderOrder = mockedScheduleNoteReminderNotification.mock.invocationCallOrder[0];

    expect(upsertOrder).toBeLessThan(outboxOrder);
    expect(outboxOrder).toBeLessThan(reminderOrder);
  });
});
