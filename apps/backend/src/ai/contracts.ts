export type ClarificationField = 'title' | 'content' | 'reminder' | 'repeat';

export type RepeatRule =
  | Readonly<{ kind: 'daily'; interval: number }>
  | Readonly<{ kind: 'weekly'; interval: number; weekdays: number[] }>
  | Readonly<{ kind: 'monthly'; interval: number; mode: 'day_of_month' }>
  | Readonly<{ kind: 'custom'; interval: number; frequency: 'minutes' | 'days' | 'weeks' | 'months' }>;

export type VoiceIntentDraftDto = Readonly<{
  title: string | null;
  content: string | null;
  reminderAtEpochMs: number | null;
  repeat: RepeatRule | null;
  keepTranscriptInContent: boolean;
  normalizedTranscript: string;
}>;

export type VoiceConfidenceDto = Readonly<{
  title: number;
  content: number;
  reminder: number;
  repeat: number;
}>;

export type VoiceClarificationDto = Readonly<{
  required: boolean;
  question: string | null;
  missingFields: ClarificationField[];
}>;

export type VoiceIntentResponseDto = Readonly<{
  draft: VoiceIntentDraftDto;
  confidence: VoiceConfidenceDto;
  clarification: VoiceClarificationDto;
}>;

export type ParseVoiceNoteIntentRequest = Readonly<{
  transcript: string;
  userId: string;
  timezone: string;
  nowEpochMs: number;
  locale: string | null;
  sessionId: string;
}>;

export type ContinueVoiceClarificationRequest = Readonly<{
  sessionId: string;
  priorDraft: VoiceIntentDraftDto;
  clarificationAnswer: string;
  timezone: string;
  nowEpochMs: number;
}>;
