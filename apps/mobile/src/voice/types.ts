import type { RepeatRule } from '../../../../packages/shared/types/reminder';

export type VoiceSessionStatus =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'clarifying'
  | 'review'
  | 'error';

export type VoiceDraftField = 'title' | 'content' | 'reminder' | 'repeat';

export type VoiceErrorCategory =
  | 'permission-denied'
  | 'recognizer-unavailable'
  | 'no-speech'
  | 'network'
  | 'timeout'
  | 'validation'
  | 'unsupported-platform'
  | 'unknown';

export type VoiceSessionError = {
  category: VoiceErrorCategory;
  message: string;
  recoverable: boolean;
  cause?: unknown;
};

export type ParseVoiceNoteIntentRequest = {
  transcript: string;
  userId: string;
  timezone: string;
  nowEpochMs: number;
  locale: string | null;
  sessionId: string;
};

export type VoiceIntentDraftDto = {
  title: string | null;
  content: string | null;
  reminderAtEpochMs: number | null;
  repeat: RepeatRule | null;
  keepTranscriptInContent: boolean;
  normalizedTranscript: string;
};

export type ContinueVoiceClarificationRequest = {
  sessionId: string;
  priorDraft: VoiceIntentDraftDto;
  clarificationAnswer: string;
  timezone: string;
  nowEpochMs: number;
};

export type VoiceConfidenceDto = {
  title: number;
  content: number;
  reminder: number;
  repeat: number;
};

export type VoiceClarificationDto = {
  required: boolean;
  question: string | null;
  missingFields: VoiceDraftField[];
};

export type VoiceIntentResponseDto = {
  draft: VoiceIntentDraftDto;
  confidence: VoiceConfidenceDto;
  clarification: VoiceClarificationDto;
};

export type VoiceEditorDraft = {
  title: string;
  content: string;
  reminder: Date | null;
  repeat: RepeatRule | null;
  keepTranscriptInContent: boolean;
  transcript: string;
};

export type VoiceDraftMappingResult = {
  editorDraft: VoiceEditorDraft;
  warnings: string[];
  clarification: {
    required: boolean;
    question: string | null;
    missingFields: VoiceDraftField[];
  };
  normalized: VoiceIntentResponseDto;
};

export type VoiceListeningState = {
  status: 'listening';
  transcript: string;
};

export type VoiceProcessingState = {
  status: 'processing';
  transcript: string;
};

export type VoiceClarifyingState = {
  status: 'clarifying';
  transcript: string;
  question: string;
  turn: number;
  maxTurns: number;
};

export type VoiceReviewState = {
  status: 'review';
  transcript: string;
  draft: VoiceEditorDraft;
  warnings: string[];
};

export type VoiceErrorState = {
  status: 'error';
  transcript: string;
  error: VoiceSessionError;
};

export type VoiceCaptureSessionState =
  | { status: 'idle'; transcript: string }
  | VoiceListeningState
  | VoiceProcessingState
  | VoiceClarifyingState
  | VoiceReviewState
  | VoiceErrorState;

export type VoiceSpeechStartOptions = {
  locale?: string;
};

export type VoiceSpeechCallbacks = {
  onPartialTranscript: (transcript: string) => void;
  onError: (error: VoiceSessionError) => void;
};

export interface VoiceSpeechRecognizer {
  ensurePermissions(): Promise<void>;
  startListening(options: VoiceSpeechStartOptions, callbacks: VoiceSpeechCallbacks): Promise<void>;
  stopListening(): Promise<string>;
  cancelListening(): void;
  dispose(): void;
}

export interface VoiceIntentClient {
  parseVoiceNoteIntent(request: ParseVoiceNoteIntentRequest): Promise<VoiceIntentResponseDto>;
  continueVoiceClarification(
    request: ContinueVoiceClarificationRequest,
  ): Promise<VoiceIntentResponseDto>;
}
