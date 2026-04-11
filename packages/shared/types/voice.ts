import type { RepeatRule } from './reminder';

// Matches mobile src/voice/types.ts VoiceDraftField
export type VoiceDraftField = 'title' | 'content' | 'reminder' | 'repeat';

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

export type ContinueVoiceClarificationRequest = {
  sessionId: string;
  priorDraft: VoiceIntentDraftDto;
  clarificationAnswer: string;
  timezone: string;
  nowEpochMs: number;
};
