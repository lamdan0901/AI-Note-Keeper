import {
  type ContinueVoiceClarificationRequest,
  type ParseVoiceNoteIntentRequest,
  type ClarificationField,
  type RepeatRule,
  type VoiceIntentResponseDto,
} from './contracts.js';
import { callNvidiaProviderJson } from './provider.js';

type ProviderConfig = Readonly<{
  apiKey: string;
  parseModel: string;
  clarifyModel: string;
}>;

type AiServiceDeps = Readonly<{
  readProviderConfig?: () => ProviderConfig | null;
  callProviderJson?: (
    input: Readonly<{ model: string; apiKey: string; systemPrompt: string; userPrompt: string }>,
  ) => Promise<unknown | null>;
}>;

export type AiService = Readonly<{
  parseVoiceNoteIntent: (request: ParseVoiceNoteIntentRequest) => Promise<VoiceIntentResponseDto>;
  continueVoiceClarification: (
    request: ContinueVoiceClarificationRequest,
  ) => Promise<VoiceIntentResponseDto>;
}>;

const EMPTY_CONFIDENCE = {
  title: 0,
  content: 0,
  reminder: 0,
  repeat: 0,
} as const;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => {
  return typeof value === 'object' && value !== null;
};

const normalizeTranscript = (value: string): string => {
  return value.replace(/\s+/g, ' ').trim();
};

const normalizeOptionalText = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const clampConfidence = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.min(1, Math.max(0, parsed));
};

const parseRepeatRule = (value: unknown): RepeatRule | null => {
  if (!isRecord(value) || typeof value.kind !== 'string' || !Number.isInteger(value.interval)) {
    return null;
  }

  if (value.kind === 'daily') {
    return { kind: 'daily', interval: Number(value.interval) };
  }

  if (value.kind === 'weekly' && Array.isArray(value.weekdays)) {
    return {
      kind: 'weekly',
      interval: Number(value.interval),
      weekdays: value.weekdays
        .map((entry) => Number(entry))
        .filter((entry) => Number.isInteger(entry)),
    };
  }

  if (value.kind === 'monthly' && value.mode === 'day_of_month') {
    return { kind: 'monthly', interval: Number(value.interval), mode: 'day_of_month' };
  }

  if (
    value.kind === 'custom' &&
    (value.frequency === 'minutes' ||
      value.frequency === 'days' ||
      value.frequency === 'weeks' ||
      value.frequency === 'months')
  ) {
    return {
      kind: 'custom',
      interval: Number(value.interval),
      frequency: value.frequency,
    };
  }

  return null;
};

const parseDeterministicTime = (
  transcript: string,
): Readonly<{ dayOffset: number; hour: number; minute: number }> | null => {
  const normalized = normalizeTranscript(transcript).toLowerCase();

  const amPmPattern =
    /\b(today|tomorrow|tommorow)\b(?:\s+at)?\s+(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?|am|pm)\b/i;
  const dayAfterTimePattern =
    /\b(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?|am|pm)\b(?:\s+on)?\s+\b(today|tomorrow|tommorow)\b/i;
  const h24Pattern = /\b(today|tomorrow|tommorow)\b(?:\s+at)?\s+([01]?\d|2[0-3]):([0-5]\d)\b/i;
  const h24DayAfterPattern =
    /\b([01]?\d|2[0-3]):([0-5]\d)\b(?:\s+on)?\s+\b(today|tomorrow|tommorow)\b/i;

  const toDayOffset = (raw: string): number => (raw.toLowerCase() === 'today' ? 0 : 1);
  const to24Hour = (hour12: number, meridiemRaw: string): number => {
    const meridiem = meridiemRaw.toLowerCase().replace(/\./g, '');
    return (hour12 % 12) + (meridiem === 'pm' ? 12 : 0);
  };

  const amPmMatch = normalized.match(amPmPattern);
  if (amPmMatch) {
    return {
      dayOffset: toDayOffset(amPmMatch[1]),
      hour: to24Hour(Number(amPmMatch[2]), amPmMatch[4]),
      minute: amPmMatch[3] ? Number(amPmMatch[3]) : 0,
    };
  }

  const dayAfterTimeMatch = normalized.match(dayAfterTimePattern);
  if (dayAfterTimeMatch) {
    return {
      dayOffset: toDayOffset(dayAfterTimeMatch[4]),
      hour: to24Hour(Number(dayAfterTimeMatch[1]), dayAfterTimeMatch[3]),
      minute: dayAfterTimeMatch[2] ? Number(dayAfterTimeMatch[2]) : 0,
    };
  }

  const h24Match = normalized.match(h24Pattern);
  if (h24Match) {
    return {
      dayOffset: toDayOffset(h24Match[1]),
      hour: Number(h24Match[2]),
      minute: Number(h24Match[3]),
    };
  }

  const h24DayAfterMatch = normalized.match(h24DayAfterPattern);
  if (h24DayAfterMatch) {
    return {
      dayOffset: toDayOffset(h24DayAfterMatch[3]),
      hour: Number(h24DayAfterMatch[1]),
      minute: Number(h24DayAfterMatch[2]),
    };
  }

  return null;
};

const parseDeterministicReminderAt = (
  input: Readonly<{ transcript: string; nowEpochMs: number }>,
): number | null => {
  const parsedTime = parseDeterministicTime(input.transcript);
  if (!parsedTime) {
    return null;
  }

  const now = new Date(input.nowEpochMs);
  const candidate = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + parsedTime.dayOffset,
    parsedTime.hour,
    parsedTime.minute,
    0,
    0,
  );

  return candidate > input.nowEpochMs ? candidate : null;
};

const extractAction = (transcript: string): string | null => {
  const normalized = normalizeTranscript(transcript);
  const withoutPrefix = normalized.replace(
    /^(?:please\s+)?(?:remind\s+me(?:\s+to)?|set(?:\s+me)?\s+(?:a\s+)?reminder(?:\s+to)?|create(?:\s+a\s+)?reminder(?:\s+to)?)\s+/i,
    '',
  );

  if (withoutPrefix === normalized) {
    return null;
  }

  const markers = [
    /\b(?:today|tomorrow|tommorow)\b/i,
    /\brepeat\b/i,
    /\bevery\s+(?:day|week|month)\b/i,
    /\bevery\s+\d+\s+(?:minutes?|days?|weeks?|months?)\b/i,
  ];

  const indexes = markers.map((marker) => {
    const match = marker.exec(withoutPrefix);
    return match && match.index > 0 ? match.index : Number.POSITIVE_INFINITY;
  });

  const firstMarkerIndex = Math.min(...indexes);
  const action = Number.isFinite(firstMarkerIndex)
    ? withoutPrefix.slice(0, firstMarkerIndex)
    : withoutPrefix;

  const cleaned = action
    .replace(/[,:;.!?\-\s]+$/g, '')
    .replace(/\b(?:at|on|for)\s*$/i, '')
    .trim();
  if (!cleaned) {
    return null;
  }

  return `${cleaned[0].toUpperCase()}${cleaned.slice(1)}`;
};

const parseDeterministicRepeat = (
  input: Readonly<{ transcript: string; reminderAtEpochMs: number }>,
): RepeatRule | null => {
  const normalized = normalizeTranscript(input.transcript).toLowerCase();

  const everyCountMatch = normalized.match(/\bevery\s+(\d+)\s+(minutes?|days?|weeks?|months?)\b/i);
  if (everyCountMatch) {
    const interval = Number(everyCountMatch[1]);
    const unit = everyCountMatch[2] ?? '';
    if (!Number.isInteger(interval) || interval < 1) {
      return null;
    }

    if (unit.startsWith('day')) {
      return { kind: 'daily', interval };
    }
    if (unit.startsWith('week')) {
      return {
        kind: 'weekly',
        interval,
        weekdays: [new Date(input.reminderAtEpochMs).getUTCDay()],
      };
    }
    if (unit.startsWith('month')) {
      return { kind: 'monthly', interval, mode: 'day_of_month' };
    }
    if (unit.startsWith('minute')) {
      return { kind: 'custom', interval, frequency: 'minutes' };
    }
  }

  if (/\bevery\s+day\b|\brepeat\s+daily\b|\beveryday\b/i.test(normalized)) {
    return { kind: 'daily', interval: 1 };
  }

  if (/\bevery\s+week\b|\brepeat\s+weekly\b/i.test(normalized)) {
    return {
      kind: 'weekly',
      interval: 1,
      weekdays: [new Date(input.reminderAtEpochMs).getUTCDay()],
    };
  }

  if (/\bevery\s+month\b|\brepeat\s+monthly\b/i.test(normalized)) {
    return { kind: 'monthly', interval: 1, mode: 'day_of_month' };
  }

  return null;
};

const parseDeterministicDraft = (input: Readonly<{ transcript: string; nowEpochMs: number }>) => {
  const normalized = normalizeTranscript(input.transcript);
  const reminderAtEpochMs = parseDeterministicReminderAt({
    transcript: normalized,
    nowEpochMs: input.nowEpochMs,
  });
  const title = extractAction(normalized);

  return {
    normalizedTranscript: normalized,
    title,
    content: title ? null : normalized,
    reminderAtEpochMs,
    repeat:
      reminderAtEpochMs !== null
        ? parseDeterministicRepeat({ transcript: normalized, reminderAtEpochMs })
        : null,
  };
};

const parseClarificationFields = (value: unknown): ClarificationField[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const allowed = new Set<ClarificationField>(['title', 'content', 'reminder', 'repeat']);
  return Array.from(
    new Set(
      value.filter(
        (entry): entry is ClarificationField =>
          typeof entry === 'string' && allowed.has(entry as ClarificationField),
      ),
    ),
  );
};

const defaultClarificationQuestion = (fields: ClarificationField[]): string => {
  if (fields.includes('reminder')) {
    return 'What time should I use for the reminder?';
  }
  if (fields.includes('content')) {
    return 'What details should be included in the note?';
  }

  return 'Could you clarify the missing detail?';
};

const buildFallbackResponse = (
  input: Readonly<{ transcript: string; nowEpochMs: number }>,
): VoiceIntentResponseDto => {
  const deterministic = parseDeterministicDraft(input);

  return {
    draft: {
      title: deterministic.title,
      content: deterministic.content,
      reminderAtEpochMs: deterministic.reminderAtEpochMs,
      repeat: deterministic.repeat,
      keepTranscriptInContent: true,
      normalizedTranscript: deterministic.normalizedTranscript,
    },
    confidence: {
      ...EMPTY_CONFIDENCE,
    },
    clarification: {
      required: false,
      question: null,
      missingFields: [],
    },
  };
};

const normalizeProviderResponse = (
  value: unknown,
  input: Readonly<{ transcript: string; nowEpochMs: number }>,
): VoiceIntentResponseDto => {
  if (!isRecord(value)) {
    return buildFallbackResponse(input);
  }

  const deterministic = parseDeterministicDraft(input);
  const rawDraft = isRecord(value.draft) ? value.draft : {};
  const rawConfidence = isRecord(value.confidence) ? value.confidence : {};
  const rawClarification = isRecord(value.clarification) ? value.clarification : {};

  const confidence = {
    title: clampConfidence(rawConfidence.title),
    content: clampConfidence(rawConfidence.content),
    reminder: clampConfidence(rawConfidence.reminder),
    repeat: clampConfidence(rawConfidence.repeat),
  };

  let title = normalizeOptionalText(rawDraft.title);
  let content = normalizeOptionalText(rawDraft.content);

  if (!title && deterministic.title) {
    title = deterministic.title;
  }

  if (!title && !content) {
    content = deterministic.content;
  }

  const providerReminderEpoch =
    rawDraft.reminderAtEpochMs === null || rawDraft.reminderAtEpochMs === undefined
      ? null
      : Number(rawDraft.reminderAtEpochMs);

  const reminderAtEpochMs =
    providerReminderEpoch &&
    Number.isFinite(providerReminderEpoch) &&
    providerReminderEpoch > input.nowEpochMs
      ? providerReminderEpoch
      : deterministic.reminderAtEpochMs;

  const providerRepeat = reminderAtEpochMs !== null ? parseRepeatRule(rawDraft.repeat) : null;
  const repeat = reminderAtEpochMs !== null ? (providerRepeat ?? deterministic.repeat) : null;

  const modelKeepTranscript = rawDraft.keepTranscriptInContent === true;
  const isLowConfidence =
    (title !== null && confidence.title < 0.6) ||
    (content !== null && confidence.content < 0.6) ||
    (title === null && content === null);

  const keepTranscriptInContent = modelKeepTranscript || isLowConfidence;

  const requiredByProvider = rawClarification.required === true;
  const providerQuestion = normalizeOptionalText(rawClarification.question);
  const missingFields = parseClarificationFields(rawClarification.missingFields);
  const repeatOnlyClarification =
    requiredByProvider && missingFields.length === 1 && missingFields[0] === 'repeat';

  const filteredMissing = missingFields.filter((field) => field !== 'repeat');
  const clarificationRequired = requiredByProvider && !repeatOnlyClarification;

  return {
    draft: {
      title,
      content,
      reminderAtEpochMs,
      repeat,
      keepTranscriptInContent,
      normalizedTranscript: deterministic.normalizedTranscript,
    },
    confidence,
    clarification: {
      required: clarificationRequired,
      question: clarificationRequired
        ? (providerQuestion ?? defaultClarificationQuestion(filteredMissing))
        : null,
      missingFields: clarificationRequired ? filteredMissing : [],
    },
  };
};

const readProviderConfigFromEnv = (): ProviderConfig | null => {
  const apiKey = process.env.NVIDIA_API_KEY;
  const zeroRetentionEnabled = process.env.NVIDIA_TRANSCRIPT_ZERO_RETENTION === 'true';
  if (!apiKey || !zeroRetentionEnabled) {
    return null;
  }

  return {
    apiKey,
    parseModel: process.env.NVIDIA_MODEL_PARSE ?? 'deepseek-ai/deepseek-v3.2',
    clarifyModel: process.env.NVIDIA_MODEL_CLARIFY ?? 'deepseek-ai/deepseek-v3.2',
  };
};

export const createAiService = (deps: AiServiceDeps = {}): AiService => {
  const readProviderConfig = deps.readProviderConfig ?? readProviderConfigFromEnv;
  const callProviderJson = deps.callProviderJson ?? callNvidiaProviderJson;

  return {
    parseVoiceNoteIntent: async (request) => {
      const normalizedTranscript = normalizeTranscript(request.transcript);
      const fallbackInput = {
        transcript: normalizedTranscript,
        nowEpochMs: request.nowEpochMs,
      };

      const providerConfig = readProviderConfig();
      if (!providerConfig) {
        return buildFallbackResponse(fallbackInput);
      }

      try {
        const providerOutput = await callProviderJson({
          model: providerConfig.parseModel,
          apiKey: providerConfig.apiKey,
          systemPrompt: `Parse voice note intent in timezone ${request.timezone}. Return JSON only.`,
          userPrompt: `Session ${request.sessionId}. Transcript: ${normalizedTranscript}`,
        });

        if (!providerOutput) {
          return buildFallbackResponse(fallbackInput);
        }

        return normalizeProviderResponse(providerOutput, fallbackInput);
      } catch {
        return buildFallbackResponse(fallbackInput);
      }
    },

    continueVoiceClarification: async (request) => {
      const normalizedAnswer = normalizeTranscript(request.clarificationAnswer);
      const fallbackInput = {
        transcript: request.priorDraft.normalizedTranscript,
        nowEpochMs: request.nowEpochMs,
      };

      const providerConfig = readProviderConfig();
      if (!providerConfig) {
        return normalizeProviderResponse(
          {
            draft: request.priorDraft,
            confidence: { title: 1, content: 1, reminder: 1, repeat: 1 },
            clarification: { required: false, question: null, missingFields: [] },
          },
          fallbackInput,
        );
      }

      try {
        const providerOutput = await callProviderJson({
          model: providerConfig.clarifyModel,
          apiKey: providerConfig.apiKey,
          systemPrompt: `Continue voice clarification in timezone ${request.timezone}. Return JSON only.`,
          userPrompt: `Session ${request.sessionId}. Prior draft: ${JSON.stringify(
            request.priorDraft,
          )}. Clarification: ${normalizedAnswer}`,
        });

        if (!providerOutput) {
          return normalizeProviderResponse(
            {
              draft: request.priorDraft,
              confidence: { title: 1, content: 1, reminder: 1, repeat: 1 },
              clarification: { required: false, question: null, missingFields: [] },
            },
            fallbackInput,
          );
        }

        const merged = isRecord(providerOutput)
          ? {
              ...providerOutput,
              draft: {
                ...request.priorDraft,
                ...(isRecord(providerOutput.draft) ? providerOutput.draft : {}),
              },
            }
          : providerOutput;

        return normalizeProviderResponse(merged, fallbackInput);
      } catch {
        return normalizeProviderResponse(
          {
            draft: request.priorDraft,
            confidence: { title: 1, content: 1, reminder: 1, repeat: 1 },
            clarification: { required: false, question: null, missingFields: [] },
          },
          fallbackInput,
        );
      }
    },
  };
};
