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
  reminder: v.optional(
    v.union(
      v.object({
        date: v.string(),
        time: v.string(),
      }),
      v.null(),
    ),
  ),
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

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

const DAY_TOKEN_PATTERN = '(today|tomorrow|tommorow)';
const AMPM_PATTERN = '(a\\.?m\\.?|p\\.?m\\.?|am|pm)';
const DAY_FIRST_AMPM_TIME_PATTERN = new RegExp(
  `\\b${DAY_TOKEN_PATTERN}\\b(?:\\s+at)?\\s+(\\d{1,2})(?::([0-5]\\d))?\\s*${AMPM_PATTERN}`,
  'i',
);
const AMPM_TIME_DAY_FIRST_PATTERN = new RegExp(
  `\\b(\\d{1,2})(?::([0-5]\\d))?\\s*${AMPM_PATTERN}(?:\\s+on)?\\s+\\b${DAY_TOKEN_PATTERN}\\b`,
  'i',
);
const DAY_FIRST_24H_TIME_PATTERN = new RegExp(
  `\\b${DAY_TOKEN_PATTERN}\\b(?:\\s+at)?\\s+([01]?\\d|2[0-3]):([0-5]\\d)\\b`,
  'i',
);
const H24_TIME_DAY_FIRST_PATTERN = new RegExp(
  `\\b([01]?\\d|2[0-3]):([0-5]\\d)\\b(?:\\s+on)?\\s+\\b${DAY_TOKEN_PATTERN}\\b`,
  'i',
);
const REMINDER_COMMAND_PREFIX =
  /^(?:please\s+)?(?:remind\s+me(?:\s+to)?|set(?:\s+me)?\s+(?:a\s+)?reminder(?:\s+to)?|create(?:\s+a\s+)?reminder(?:\s+to)?)\s+/i;
const ACTION_CLAUSE_MARKERS: RegExp[] = [
  /\b(?:today|tomorrow|tommorow)\b/i,
  /\brepeat\b/i,
  /\bevery\s+(?:day|week|month)\b/i,
  /\bevery\s+\d+\s+(?:minutes?|days?|weeks?|months?)\b/i,
];
const REPEAT_QUESTION_HINT_PATTERN = /\b(repeat|recurr|every|often)\b/i;

type DeterministicTimeParse = {
  dayOffset: number;
  hour24: number;
  minute: number;
};

type DeterministicDraftExtraction = {
  title: string | null;
  content: string | null;
  reminderAtEpochMs: number | null;
  repeat: RepeatRule | null;
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

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function numberFromParts(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): number {
  const value = parts.find((part) => part.type === type)?.value ?? '0';
  return Number(value);
}

function datePartsInTimezone(epochMs: number, timezone: string): DateParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    weekday: 'short',
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date(epochMs));
  let hour = numberFromParts(parts, 'hour');
  if (hour === 24) {
    hour = 0;
  }

  const weekdayText = parts.find((part) => part.type === 'weekday')?.value ?? '';
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: numberFromParts(parts, 'year'),
    month: numberFromParts(parts, 'month'),
    day: numberFromParts(parts, 'day'),
    hour,
    minute: numberFromParts(parts, 'minute'),
    second: numberFromParts(parts, 'second'),
    weekday: weekdayMap[weekdayText] ?? 0,
  };
}

function wallClockToEpochMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timezone: string,
): number {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  const actual = datePartsInTimezone(utcGuess, timezone);

  const wantedMinutes = hour * 60 + minute;
  let actualMinutes = actual.hour * 60 + actual.minute;

  if (actual.day !== day || actual.month !== month || actual.year !== year) {
    const wantedDayMs = Date.UTC(year, month - 1, day);
    const actualDayMs = Date.UTC(actual.year, actual.month - 1, actual.day);
    actualMinutes += (actualDayMs - wantedDayMs) / 60000;
  }

  const offsetMinutes = actualMinutes - wantedMinutes;
  const result = utcGuess - offsetMinutes * 60000;

  const verify = datePartsInTimezone(result, timezone);
  if (verify.hour !== hour || verify.minute !== minute) {
    const verifyMinutes = verify.hour * 60 + verify.minute;
    const diff = (hour * 60 + minute - verifyMinutes + 1440) % 1440;
    return result + diff * 60000;
  }

  return result;
}

function toDayOffset(dayTokenRaw: string | undefined): number | null {
  const dayToken = (dayTokenRaw ?? '').toLowerCase();
  if (dayToken === 'today') {
    return 0;
  }
  if (dayToken === 'tomorrow' || dayToken === 'tommorow') {
    return 1;
  }
  return null;
}

function parse12HourTime(
  hourText: string,
  minuteText: string | undefined,
  meridiemText: string,
): {
  hour24: number;
  minute: number;
} | null {
  const hour12 = Number(hourText);
  const minute = minuteText ? Number(minuteText) : 0;
  if (!Number.isInteger(hour12) || hour12 < 1 || hour12 > 12) {
    return null;
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }

  const meridiem = meridiemText.toLowerCase().replace(/\./g, '');
  if (meridiem !== 'am' && meridiem !== 'pm') {
    return null;
  }

  const hour24 = (hour12 % 12) + (meridiem === 'pm' ? 12 : 0);
  return { hour24, minute };
}

function parse24HourTime(
  hourText: string,
  minuteText: string,
): { hour24: number; minute: number } | null {
  const hour24 = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour24) || hour24 < 0 || hour24 > 23) {
    return null;
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }
  return { hour24, minute };
}

function parseDeterministicTimeFromTranscript(transcript: string): DeterministicTimeParse | null {
  const normalizedTranscript = normalizeTranscript(transcript).toLowerCase();

  const dayFirstAmPmMatch = normalizedTranscript.match(DAY_FIRST_AMPM_TIME_PATTERN);
  if (dayFirstAmPmMatch) {
    const dayOffset = toDayOffset(dayFirstAmPmMatch[1]);
    const time = parse12HourTime(
      dayFirstAmPmMatch[2] ?? '',
      dayFirstAmPmMatch[3],
      dayFirstAmPmMatch[4] ?? '',
    );
    if (dayOffset !== null && time) {
      return { dayOffset, ...time };
    }
  }

  const amPmTimeDayFirstMatch = normalizedTranscript.match(AMPM_TIME_DAY_FIRST_PATTERN);
  if (amPmTimeDayFirstMatch) {
    const dayOffset = toDayOffset(amPmTimeDayFirstMatch[4]);
    const time = parse12HourTime(
      amPmTimeDayFirstMatch[1] ?? '',
      amPmTimeDayFirstMatch[2],
      amPmTimeDayFirstMatch[3] ?? '',
    );
    if (dayOffset !== null && time) {
      return { dayOffset, ...time };
    }
  }

  const dayFirst24hMatch = normalizedTranscript.match(DAY_FIRST_24H_TIME_PATTERN);
  if (dayFirst24hMatch) {
    const dayOffset = toDayOffset(dayFirst24hMatch[1]);
    const time = parse24HourTime(dayFirst24hMatch[2] ?? '', dayFirst24hMatch[3] ?? '');
    if (dayOffset !== null && time) {
      return { dayOffset, ...time };
    }
  }

  const h24TimeDayFirstMatch = normalizedTranscript.match(H24_TIME_DAY_FIRST_PATTERN);
  if (h24TimeDayFirstMatch) {
    const dayOffset = toDayOffset(h24TimeDayFirstMatch[3]);
    const time = parse24HourTime(h24TimeDayFirstMatch[1] ?? '', h24TimeDayFirstMatch[2] ?? '');
    if (dayOffset !== null && time) {
      return { dayOffset, ...time };
    }
  }

  return null;
}

function parseDeterministicReminderEpochMs(input: {
  transcript: string;
  nowEpochMs: number;
  timezone: string;
}): number | null {
  if (!isValidTimezone(input.timezone)) {
    return null;
  }

  const parsedTime = parseDeterministicTimeFromTranscript(input.transcript);
  if (!parsedTime) {
    return null;
  }

  const nowParts = datePartsInTimezone(input.nowEpochMs, input.timezone);
  const targetDate = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day));
  targetDate.setUTCDate(targetDate.getUTCDate() + parsedTime.dayOffset);

  const reminderAtEpochMs = wallClockToEpochMs(
    targetDate.getUTCFullYear(),
    targetDate.getUTCMonth() + 1,
    targetDate.getUTCDate(),
    parsedTime.hour24,
    parsedTime.minute,
    0,
    input.timezone,
  );

  if (!Number.isFinite(reminderAtEpochMs) || reminderAtEpochMs <= input.nowEpochMs) {
    return null;
  }

  return reminderAtEpochMs;
}

function capitalizeFirstLetter(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function extractActionFromReminderTranscript(transcript: string): string | null {
  const normalizedTranscript = normalizeTranscript(transcript);
  const withoutPrefix = normalizedTranscript.replace(REMINDER_COMMAND_PREFIX, '');

  if (withoutPrefix === normalizedTranscript) {
    return null;
  }

  const lower = withoutPrefix.toLowerCase();
  const markerIndexes = ACTION_CLAUSE_MARKERS.map((pattern) => {
    const match = pattern.exec(lower);
    return match && match.index > 0 ? match.index : Number.POSITIVE_INFINITY;
  });

  const firstMarkerIndex = Math.min(...markerIndexes);
  const actionCandidate = Number.isFinite(firstMarkerIndex)
    ? withoutPrefix.slice(0, firstMarkerIndex)
    : withoutPrefix;

  const cleaned = actionCandidate
    .replace(/[,:;.!?\-\s]+$/g, '')
    .replace(/\b(?:at|on|for)\s*$/i, '')
    .trim();

  return cleaned.length > 0 ? cleaned : null;
}

function parseDeterministicRepeatRule(input: {
  transcript: string;
  reminderAtEpochMs: number;
  timezone: string;
}): RepeatRule | null {
  const normalizedTranscript = normalizeTranscript(input.transcript).toLowerCase();

  const everyCountMatch = normalizedTranscript.match(
    /\bevery\s+(\d+)\s+(minutes?|days?|weeks?|months?)\b/i,
  );
  if (everyCountMatch) {
    const interval = Number(everyCountMatch[1]);
    const unit = everyCountMatch[2]?.toLowerCase() ?? '';
    if (!Number.isInteger(interval) || interval < 1) {
      return null;
    }
    if (unit.startsWith('day')) {
      return { kind: 'daily', interval };
    }
    if (unit.startsWith('week')) {
      const reminderParts = datePartsInTimezone(input.reminderAtEpochMs, input.timezone);
      return {
        kind: 'weekly',
        interval,
        weekdays: [reminderParts.weekday],
      };
    }
    if (unit.startsWith('month')) {
      return { kind: 'monthly', interval, mode: 'day_of_month' };
    }
    if (unit.startsWith('minute')) {
      return { kind: 'custom', interval, frequency: 'minutes' };
    }
  }

  if (
    /\brepeat\s+daily\b/i.test(normalizedTranscript) ||
    /\bevery\s+day\b/i.test(normalizedTranscript) ||
    /\beveryday\b/i.test(normalizedTranscript)
  ) {
    return { kind: 'daily', interval: 1 };
  }

  if (
    /\brepeat\s+weekly\b/i.test(normalizedTranscript) ||
    /\bevery\s+week\b/i.test(normalizedTranscript)
  ) {
    const reminderParts = datePartsInTimezone(input.reminderAtEpochMs, input.timezone);
    return {
      kind: 'weekly',
      interval: 1,
      weekdays: [reminderParts.weekday],
    };
  }

  if (
    /\brepeat\s+monthly\b/i.test(normalizedTranscript) ||
    /\bevery\s+month\b/i.test(normalizedTranscript)
  ) {
    return { kind: 'monthly', interval: 1, mode: 'day_of_month' };
  }

  return null;
}

function parseDeterministicDraftExtraction(input: {
  transcript: string;
  nowEpochMs: number;
  timezone: string;
}): DeterministicDraftExtraction {
  const normalizedTranscript = normalizeTranscript(input.transcript);
  const action = extractActionFromReminderTranscript(normalizedTranscript);
  const reminderAtEpochMs = parseDeterministicReminderEpochMs({
    transcript: normalizedTranscript,
    nowEpochMs: input.nowEpochMs,
    timezone: input.timezone,
  });

  const repeat =
    reminderAtEpochMs !== null
      ? parseDeterministicRepeatRule({
          transcript: normalizedTranscript,
          reminderAtEpochMs,
          timezone: input.timezone,
        })
      : null;

  return {
    title: action ? capitalizeFirstLetter(action) : null,
    content: action,
    reminderAtEpochMs,
    repeat,
  };
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

function stripOptionalClarificationFields(
  fields: ClarificationField[],
): Exclude<ClarificationField, 'repeat'>[] {
  return fields.filter(
    (field): field is Exclude<ClarificationField, 'repeat'> => field !== 'repeat',
  );
}

function normalizeRepeat(rawRepeat: unknown, triggerAt: number): RepeatRule | null {
  return coerceRepeatRule({ repeat: rawRepeat, triggerAt });
}

type ParsedAiReminder =
  | { status: 'missing' }
  | { status: 'invalid' }
  | { status: 'valid'; epochMs: number };

function parseAiReminder(rawReminder: unknown, timezone: string): ParsedAiReminder {
  if (rawReminder === null || rawReminder === undefined) {
    return { status: 'missing' };
  }
  if (!isRecord(rawReminder)) {
    return { status: 'invalid' };
  }

  const dateStr = typeof rawReminder.date === 'string' ? rawReminder.date : null;
  const timeStr = typeof rawReminder.time === 'string' ? rawReminder.time : null;

  if (!dateStr || !timeStr) {
    return { status: 'invalid' };
  }

  const dateMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = timeStr.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);

  if (!dateMatch || !timeMatch) {
    return { status: 'invalid' };
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] ?? '0');

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second)
  ) {
    return { status: 'invalid' };
  }

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59 ||
    !isValidTimezone(timezone)
  ) {
    return { status: 'invalid' };
  }

  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() + 1 !== month ||
    utcDate.getUTCDate() !== day
  ) {
    return { status: 'invalid' };
  }

  const epochMs = wallClockToEpochMs(year, month, day, hour, minute, second, timezone);
  if (!Number.isFinite(epochMs)) {
    return { status: 'invalid' };
  }

  return { status: 'valid', epochMs };
}

export function normalizeTranscript(transcript: string): string {
  return transcript.replace(/\s+/g, ' ').trim();
}

export function buildTranscriptFallbackResponse(input: {
  transcript: string;
  nowEpochMs: number;
  timezone: string;
}): VoiceIntentResponse {
  const normalizedTranscript = normalizeTranscript(input.transcript);
  const deterministic = parseDeterministicDraftExtraction({
    transcript: normalizedTranscript,
    nowEpochMs: input.nowEpochMs,
    timezone: input.timezone,
  });

  return {
    draft: {
      title: deterministic.title,
      content: deterministic.title ? null : normalizedTranscript || null,
      reminderAtEpochMs: deterministic.reminderAtEpochMs,
      repeat: deterministic.repeat,
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
    timezone: string;
  },
): VoiceIntentResponse {
  const normalizedTranscript = normalizeTranscript(input.transcript);
  const fallback = buildTranscriptFallbackResponse({
    transcript: normalizedTranscript,
    nowEpochMs: input.nowEpochMs,
    timezone: input.timezone,
  });

  if (!isRecord(value)) {
    return fallback;
  }

  const rawDraft = isRecord(value.draft) ? value.draft : {};
  const rawConfidence = isRecord(value.confidence) ? value.confidence : {};
  const rawClarification = isRecord(value.clarification) ? value.clarification : {};

  const deterministic = parseDeterministicDraftExtraction({
    transcript: normalizedTranscript,
    nowEpochMs: input.nowEpochMs,
    timezone: input.timezone,
  });

  let title = normalizeOptionalText(rawDraft.title);
  let content = normalizeOptionalText(rawDraft.content);

  const confidence: VoiceConfidence = {
    title: clampConfidence(rawConfidence.title),
    content: clampConfidence(rawConfidence.content),
    reminder: clampConfidence(rawConfidence.reminder),
    repeat: clampConfidence(rawConfidence.repeat),
  };

  const draftNormalizedTranscript = normalizedTranscript;

  const aiReminder = parseAiReminder(rawDraft.reminder, input.timezone);
  const hasLegacyReminderEpoch =
    rawDraft.reminderAtEpochMs !== null &&
    rawDraft.reminderAtEpochMs !== undefined &&
    !(typeof rawDraft.reminderAtEpochMs === 'string' && rawDraft.reminderAtEpochMs.trim() === '');
  const legacyReminderEpoch = hasLegacyReminderEpoch
    ? typeof rawDraft.reminderAtEpochMs === 'number'
      ? rawDraft.reminderAtEpochMs
      : Number(rawDraft.reminderAtEpochMs)
    : null;

  const hasFutureAiReminder =
    aiReminder.status === 'valid' && aiReminder.epochMs > input.nowEpochMs;
  const hasFutureLegacyReminder =
    legacyReminderEpoch &&
    Number.isFinite(legacyReminderEpoch) &&
    legacyReminderEpoch > input.nowEpochMs;
  const providerAttemptedReminder = aiReminder.status !== 'missing' || hasLegacyReminderEpoch;

  let providerReminderRejected = false;
  let reminderAtEpochMs: number | null = null;
  if (hasFutureAiReminder) {
    reminderAtEpochMs = aiReminder.epochMs;
  } else if (hasFutureLegacyReminder) {
    reminderAtEpochMs = legacyReminderEpoch;
  } else if (providerAttemptedReminder) {
    if (deterministic.reminderAtEpochMs !== null) {
      // Provider reminder can be stale/invalid. Recover from deterministic parsing of user transcript.
      reminderAtEpochMs = deterministic.reminderAtEpochMs;
    } else {
      providerReminderRejected = true;
      reminderAtEpochMs = null;
    }
  } else {
    reminderAtEpochMs = deterministic.reminderAtEpochMs;
  }

  if (title === null && content === null) {
    if (deterministic.title) {
      title = deterministic.title;
      content = null;
    } else {
      content = normalizedTranscript || null;
    }
  }

  const providerRepeat =
    reminderAtEpochMs !== null ? normalizeRepeat(rawDraft.repeat, reminderAtEpochMs) : null;
  const repeat = reminderAtEpochMs !== null ? (providerRepeat ?? deterministic.repeat) : null;

  const modelKeepTranscript = rawDraft.keepTranscriptInContent === true;

  const isLowConfidence =
    (title !== null && confidence.title < 0.6) ||
    (content !== null && confidence.content < 0.6) ||
    (title === null && content === null);

  const keepTranscriptInContent = modelKeepTranscript || isLowConfidence;

  const providerQuestion = normalizeOptionalText(rawClarification.question);
  const rawMissingFields = normalizeClarificationFields(rawClarification.missingFields);
  const requiredByProvider = rawClarification.required === true;
  const repeatOnlyProviderAsk =
    requiredByProvider &&
    stripOptionalClarificationFields(rawMissingFields).length === 0 &&
    (rawMissingFields.includes('repeat') ||
      (providerQuestion !== null && REPEAT_QUESTION_HINT_PATTERN.test(providerQuestion)));

  const effectiveMissingFields = stripOptionalClarificationFields(rawMissingFields);
  const resolvedMissingFields: ClarificationField[] = providerReminderRejected
    ? Array.from(new Set<ClarificationField>([...effectiveMissingFields, 'reminder']))
    : effectiveMissingFields;

  const required = providerReminderRejected || (requiredByProvider && !repeatOnlyProviderAsk);
  const shouldUseProviderQuestion =
    providerQuestion !== null && !REPEAT_QUESTION_HINT_PATTERN.test(providerQuestion);
  const question = required
    ? shouldUseProviderQuestion
      ? providerQuestion
      : defaultClarificationQuestion(resolvedMissingFields)
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
      missingFields: required ? resolvedMissingFields : [],
    },
  };
}

export function normalizeClarificationFallback(
  priorDraft: VoiceDraft,
  nowEpochMs: number,
  timezone: string,
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
      timezone,
    },
  );
}
