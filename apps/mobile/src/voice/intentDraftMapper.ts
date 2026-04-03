import { coerceRepeatRule } from '../../../../packages/shared/utils/repeatCodec';
import type { VoiceDraftField, VoiceDraftMappingResult, VoiceIntentResponseDto } from './types';

const CONTENT_CONFIDENCE_FALLBACK_THRESHOLD = 0.6;

function normalizeText(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeMissingFields(fields: VoiceDraftField[] | null | undefined): VoiceDraftField[] {
  if (!fields || fields.length === 0) {
    return [];
  }

  const allowed: ReadonlySet<VoiceDraftField> = new Set(['title', 'content', 'reminder', 'repeat']);

  return Array.from(new Set(fields.filter((field) => allowed.has(field))));
}

function buildContent(input: {
  extractedContent: string;
  transcript: string;
  keepTranscriptInContent: boolean;
  hasTitle: boolean;
}): string {
  const { extractedContent, transcript, keepTranscriptInContent, hasTitle } = input;

  if (!keepTranscriptInContent) {
    return extractedContent;
  }

  if (!extractedContent) {
    return hasTitle ? '' : transcript;
  }

  if (!transcript || transcript === extractedContent) {
    return extractedContent;
  }

  return `${extractedContent}\n\nTranscript:\n${transcript}`;
}

type MapperOptions = {
  nowEpochMs?: number;
};

export function mapVoiceIntentDraftToEditor(
  response: VoiceIntentResponseDto,
  options?: MapperOptions,
): VoiceDraftMappingResult {
  const nowEpochMs = options?.nowEpochMs ?? Date.now();
  const warnings: string[] = [];

  const transcript = normalizeText(response.draft.normalizedTranscript);
  const title = normalizeText(response.draft.title);
  const extractedContent = normalizeText(response.draft.content);

  const reminderCandidate = response.draft.reminderAtEpochMs;
  const validReminderMs =
    typeof reminderCandidate === 'number' &&
    Number.isFinite(reminderCandidate) &&
    reminderCandidate > nowEpochMs
      ? reminderCandidate
      : null;

  if (reminderCandidate !== null && validReminderMs === null) {
    warnings.push('Discarded non-future reminder from AI draft.');
  }

  const reminder = validReminderMs !== null ? new Date(validReminderMs) : null;

  const repeat =
    validReminderMs !== null
      ? coerceRepeatRule({
          repeat: response.draft.repeat,
          triggerAt: validReminderMs,
        })
      : null;

  if (response.draft.repeat && repeat === null) {
    warnings.push('Discarded invalid repeat rule from AI draft.');
  }

  const isLowConfidence =
    (title.length > 0 && response.confidence.title < CONTENT_CONFIDENCE_FALLBACK_THRESHOLD) ||
    (extractedContent.length > 0 &&
      response.confidence.content < CONTENT_CONFIDENCE_FALLBACK_THRESHOLD) ||
    (title.length === 0 && extractedContent.length === 0);

  const keepTranscriptInContent = response.draft.keepTranscriptInContent || isLowConfidence;

  const content = buildContent({
    extractedContent,
    transcript,
    keepTranscriptInContent,
    hasTitle: title.length > 0,
  });

  const missingFields = normalizeMissingFields(response.clarification.missingFields);

  const clarificationQuestion = response.clarification.required
    ? normalizeText(response.clarification.question) || 'Could you clarify the missing detail?'
    : null;

  return {
    editorDraft: {
      title,
      content,
      reminder,
      repeat,
      keepTranscriptInContent,
      transcript,
    },
    warnings,
    clarification: {
      required: response.clarification.required,
      question: clarificationQuestion,
      missingFields,
    },
    normalized: {
      ...response,
      draft: {
        ...response.draft,
        title: title || null,
        content: extractedContent || null,
        reminderAtEpochMs: validReminderMs,
        repeat,
        keepTranscriptInContent,
        normalizedTranscript: transcript,
      },
      clarification: {
        required: response.clarification.required,
        question: clarificationQuestion,
        missingFields,
      },
    },
  };
}
