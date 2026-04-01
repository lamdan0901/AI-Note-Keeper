import { v } from 'convex/values';
import type { RepeatRule } from '../../packages/shared/types/reminder';
import { coerceRepeatRule } from '../../packages/shared/utils/repeatCodec';

export type ClarificationField = 'title' | 'content' | 'reminder' | 'repeat';

export type VoiceDraft = {
  title: string | null;
  content: string | null;
  reminderAtEpochMs: number | null;
  repeat: RepeatRule | null;
  keepTranscriptInContent: boolean;
  normalizedTranscript: string;
};

export type VoiceConfidence = {
  title: number;
  content: number;
  reminder: number;
  repeat: number;
};

export type VoiceClarification = {
  required: boolean;
  question: string | null;
  missingFields: ClarificationField[];
};

export type VoiceIntentResponse = {
  draft: VoiceDraft;
  confidence: VoiceConfidence;
  clarification: VoiceClarification;
};

const clarificationFieldValidator = v.union(
  v.literal('title'),
  v.literal('content'),
  v.literal('reminder'),
  v.literal('repeat'),
);

const repeatValidator = v.union(
  v.object({ kind: v.literal('daily'), interval: v.number() }),
  v.object({
    kind: v.literal('weekly'),
    interval: v.number(),
    weekdays: v.array(v.number()),
  }),
  v.object({
    kind: v.literal('monthly'),
    interval: v.number(),
    mode: v.literal('day_of_month'),
  }),
  v.object({
    kind: v.literal('custom'),
    interval: v.number(),
    frequency: v.union(
      v.literal('minutes'),
      v.literal('days'),
      v.literal('weeks'),
      v.literal('months'),
    ),
  }),
);

export const voiceDraftValidator = v.object({
  title: v.union(v.string(), v.null()),
  content: v.union(v.string(), v.null()),
  reminderAtEpochMs: v.union(v.number(), v.null()),
  repeat: v.union(repeatValidator, v.null()),
  keepTranscriptInContent: v.boolean(),
  normalizedTranscript: v.string(),
});

export const voiceConfidenceValidator = v.object({
  title: v.number(),
  content: v.number(),
  reminder: v.number(),
  repeat: v.number(),
});

export const voiceClarificationValidator = v.object({
  required: v.boolean(),
  question: v.union(v.string(), v.null()),
  missingFields: v.array(clarificationFieldValidator),
});

export const voiceIntentResponseValidator = v.object({
  draft: voiceDraftValidator,
  confidence: voiceConfidenceValidator,
  clarification: voiceClarificationValidator,
});

export const parseVoiceNoteIntentArgsValidator = {
  transcript: v.string(),
  userId: v.string(),
  timezone: v.string(),
  nowEpochMs: v.number(),
  locale: v.optional(v.union(v.string(), v.null())),
  sessionId: v.string(),
};

export const continueVoiceClarificationArgsValidator = {
  sessionId: v.string(),
  priorDraft: voiceDraftValidator,
  clarificationAnswer: v.string(),
  timezone: v.string(),
  nowEpochMs: v.number(),
};

const CLARIFICATION_FIELDS: ReadonlySet<ClarificationField> = new Set([
  'title',
  'content',
  'reminder',
  'repeat',
]);

const EMPTY_CONFIDENCE: VoiceConfidence = {
  title: 0,
  content: 0,
  reminder: 0,
  repeat: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clampConfidence(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  if (parsed < 0) {
    return 0;
  }
  if (parsed > 1) {
    return 1;
  }
  return parsed;
}

function defaultClarificationQuestion(missingFields: ClarificationField[]): string {
  if (missingFields.includes('reminder')) {
    return 'What time should I use for the reminder?';
  }
  if (missingFields.includes('repeat')) {
    return 'Should this reminder repeat, and how often?';
  }
  if (missingFields.includes('content')) {
    return 'What details should be included in the note?';
  }
  return 'Could you clarify the missing detail?';
}

function normalizeClarificationFields(value: unknown): ClarificationField[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const filtered = value.filter(
    (field): field is ClarificationField =>
      typeof field === 'string' && CLARIFICATION_FIELDS.has(field as ClarificationField),
  );

  return Array.from(new Set(filtered));
}

function normalizeRepeat(rawRepeat: unknown, triggerAt: number): RepeatRule | null {
  return coerceRepeatRule({ repeat: rawRepeat, triggerAt });
}

export function normalizeTranscript(transcript: string): string {
  return transcript.replace(/\s+/g, ' ').trim();
}

export function buildTranscriptFallbackResponse(transcript: string): VoiceIntentResponse {
  const normalizedTranscript = normalizeTranscript(transcript);

  return {
    draft: {
      title: null,
      content: normalizedTranscript || null,
      reminderAtEpochMs: null,
      repeat: null,
      keepTranscriptInContent: true,
      normalizedTranscript,
    },
    confidence: { ...EMPTY_CONFIDENCE },
    clarification: {
      required: false,
      question: null,
      missingFields: [],
    },
  };
}

export function normalizeVoiceIntentResponse(
  value: unknown,
  input: {
    transcript: string;
    nowEpochMs: number;
  },
): VoiceIntentResponse {
  const normalizedTranscript = normalizeTranscript(input.transcript);
  const fallback = buildTranscriptFallbackResponse(normalizedTranscript);

  if (!isRecord(value)) {
    return fallback;
  }

  const rawDraft = isRecord(value.draft) ? value.draft : {};
  const rawConfidence = isRecord(value.confidence) ? value.confidence : {};
  const rawClarification = isRecord(value.clarification) ? value.clarification : {};

  const title = normalizeOptionalText(rawDraft.title);
  let content = normalizeOptionalText(rawDraft.content);

  const reminderCandidate =
    typeof rawDraft.reminderAtEpochMs === 'number'
      ? rawDraft.reminderAtEpochMs
      : Number(rawDraft.reminderAtEpochMs);

  const hasFutureReminder =
    Number.isFinite(reminderCandidate) && reminderCandidate > input.nowEpochMs;
  const reminderAtEpochMs = hasFutureReminder ? reminderCandidate : null;

  const repeat =
    reminderAtEpochMs !== null ? normalizeRepeat(rawDraft.repeat, reminderAtEpochMs) : null;

  const confidence: VoiceConfidence = {
    title: clampConfidence(rawConfidence.title),
    content: clampConfidence(rawConfidence.content),
    reminder: clampConfidence(rawConfidence.reminder),
    repeat: clampConfidence(rawConfidence.repeat),
  };

  const fromDraftTranscript = normalizeOptionalText(rawDraft.normalizedTranscript);
  const draftNormalizedTranscript = fromDraftTranscript ?? normalizedTranscript;

  const modelKeepTranscript = rawDraft.keepTranscriptInContent === true;

  if (!title && !content) {
    content = draftNormalizedTranscript || null;
  }

  const keepTranscriptInContent =
    modelKeepTranscript || confidence.content < 0.6 || content === null;

  const required = rawClarification.required === true;
  const missingFields = normalizeClarificationFields(rawClarification.missingFields);
  const question = required
    ? (normalizeOptionalText(rawClarification.question) ??
      defaultClarificationQuestion(missingFields))
    : null;

  return {
    draft: {
      title,
      content,
      reminderAtEpochMs,
      repeat,
      keepTranscriptInContent,
      normalizedTranscript: draftNormalizedTranscript,
    },
    confidence,
    clarification: {
      required,
      question,
      missingFields: required ? missingFields : [],
    },
  };
}

export function normalizeClarificationFallback(
  priorDraft: VoiceDraft,
  nowEpochMs: number,
): VoiceIntentResponse {
  return normalizeVoiceIntentResponse(
    {
      draft: priorDraft,
      confidence: {
        title: 1,
        content: 1,
        reminder: 1,
        repeat: 1,
      },
      clarification: {
        required: false,
        question: null,
        missingFields: [],
      },
    },
    {
      transcript: priorDraft.normalizedTranscript,
      nowEpochMs,
    },
  );
}
