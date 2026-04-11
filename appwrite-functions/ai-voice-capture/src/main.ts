import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// Appwrite function context types
// ---------------------------------------------------------------------------

interface AppwriteRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  query: Record<string, string>;
}

interface AppwriteResponse {
  json(data: unknown, statusCode?: number): void;
}

interface AppwriteContext {
  req: AppwriteRequest;
  res: AppwriteResponse;
  log: (msg: string) => void;
  error: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// Domain types — inlined from packages/shared/types/reminder.ts and aiSchemas.ts
// ---------------------------------------------------------------------------

type RepeatRule =
  | { kind: 'daily'; interval: number }
  | { kind: 'weekly'; interval: number; weekdays: number[] }
  | { kind: 'monthly'; interval: number; mode: 'day_of_month' }
  | { kind: 'custom'; interval: number; frequency: 'minutes' | 'days' | 'weeks' | 'months' };

type ClarificationField = 'title' | 'content' | 'reminder' | 'repeat';

type VoiceDraft = {
  title: string | null;
  content: string | null;
  reminderAtEpochMs: number | null;
  repeat: RepeatRule | null;
  keepTranscriptInContent: boolean;
  normalizedTranscript: string;
};

type VoiceConfidence = {
  title: number;
  content: number;
  reminder: number;
  repeat: number;
};

type VoiceClarification = {
  required: boolean;
  question: string | null;
  missingFields: ClarificationField[];
};

type VoiceIntentResponse = {
  draft: VoiceDraft;
  confidence: VoiceConfidence;
  clarification: VoiceClarification;
};

type ParseArgs = {
  transcript: string;
  userId: string;
  timezone: string;
  nowEpochMs: number;
  locale?: string | null;
  sessionId: string;
};

type ClarifyArgs = {
  sessionId: string;
  priorDraft: VoiceDraft;
  clarificationAnswer: string;
  timezone: string;
  nowEpochMs: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDER_TIMEOUT_MS = 25_000;
const CLARIFICATION_FIELDS: ReadonlySet<ClarificationField> = new Set([
  'title',
  'content',
  'reminder',
  'repeat',
]);
const EMPTY_CONFIDENCE: VoiceConfidence = { title: 0, content: 0, reminder: 0, repeat: 0 };

// ---------------------------------------------------------------------------
// Prompt builders — ported from convex/functions/aiPrompts.ts
// ---------------------------------------------------------------------------

type PromptContext = { timezone: string; nowEpochMs: number; locale: string | null };

function formatNow(nowEpochMs: number): string {
  return new Date(nowEpochMs).toISOString();
}

function localeInstruction(locale: string | null): string {
  return locale ? `User locale: ${locale}.` : 'User locale is unknown.';
}

function buildParseVoiceNoteSystemPrompt(context: PromptContext): string {
  return [
    'You extract a structured note draft from a voice transcript.',
    'Return JSON only, with no markdown and no extra keys.',
    'Use this exact JSON shape:',
    '{"draft":{"title":string|null,"content":string|null,"reminder":{"date":string,"time":string}|null,"repeat":RepeatRule|null,"keepTranscriptInContent":boolean,"normalizedTranscript":string},"confidence":{"title":number,"content":number,"reminder":number,"repeat":number},"clarification":{"required":boolean,"question":string|null,"missingFields":["title"|"content"|"reminder"|"repeat"]}}',
    "reminder.date must be YYYY-MM-DD and reminder.time must be HH:mm (24-hour) in the user's local time.",
    'RepeatRule must be one of:',
    '- {"kind":"daily","interval":number>=1}',
    '- {"kind":"weekly","interval":number>=1,"weekdays":number[0..6] non-empty}',
    '- {"kind":"monthly","interval":number>=1,"mode":"day_of_month"}',
    '- {"kind":"custom","interval":number>=1,"frequency":"minutes"|"days"|"weeks"|"months"}',
    `Reference timezone: ${context.timezone}.`,
    `Reference time (ISO): ${formatNow(context.nowEpochMs)}.`,
    localeInstruction(context.locale),
    'Clarification is required for ambiguous times (for example "at 7" without AM/PM), missing date context, or incomplete repeat details.',
    'If reminderAtEpochMs is null then repeat must be null.',
    'If both title and content confidence are low, or both are empty, set keepTranscriptInContent=true. Otherwise, set keepTranscriptInContent=false.',
    'Extract ONLY the user\'s note intent for title/content, omitting ALL timing, reminder, and recurrence details (e.g., "do exercise tomorrow 7 a.m repeat daily" -> "do exercise").',
    'If the extracted intent is short, put it in the title and set content to null.',
    'If the extracted intent is long, put it in the content and set title to null.',
  ].join('\n');
}

function buildParseVoiceNoteUserPrompt(input: { sessionId: string; transcript: string }): string {
  return [`SessionId: ${input.sessionId}`, 'Transcript:', input.transcript].join('\n');
}

function buildClarificationSystemPrompt(context: PromptContext): string {
  return [
    'You update an existing note draft using a clarification answer.',
    'Return JSON only, with the same schema as the parse response.',
    'Schema reminder:',
    '{"draft":{"title":string|null,"content":string|null,"reminder":{"date":string,"time":string}|null,"repeat":RepeatRule|null,"keepTranscriptInContent":boolean,"normalizedTranscript":string},...}',
    "reminder.date must be YYYY-MM-DD and reminder.time must be HH:mm (24-hour) in the user's local time.",
    `Reference timezone: ${context.timezone}.`,
    `Reference time (ISO): ${formatNow(context.nowEpochMs)}.`,
    localeInstruction(context.locale),
    'If reminderAtEpochMs is null then repeat must be null.',
    'Only keep clarification.required=true when essential data is still missing.',
    "Extract only the user's note intent for title/content, omitting timing/reminder details.",
    'If the extracted intent is short, put it in the title and set content to null.',
    'If the extracted intent is long, put it in the content and set title to null.',
  ].join('\n');
}

function buildClarificationUserPrompt(input: {
  sessionId: string;
  priorDraft: VoiceDraft;
  clarificationAnswer: string;
}): string {
  return [
    `SessionId: ${input.sessionId}`,
    'Prior draft JSON:',
    JSON.stringify(input.priorDraft),
    'Clarification answer:',
    input.clarificationAnswer,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Deterministic helpers — ported from convex/functions/aiSchemas.ts
// ---------------------------------------------------------------------------

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

type DeterministicTimeParse = { dayOffset: number; hour24: number; minute: number };
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
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clampConfidence(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
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
  if (hour === 24) hour = 0;
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
  if (dayToken === 'today') return 0;
  if (dayToken === 'tomorrow' || dayToken === 'tommorow') return 1;
  return null;
}

function parse12HourTime(
  hourText: string,
  minuteText: string | undefined,
  meridiemText: string,
): { hour24: number; minute: number } | null {
  const hour12 = Number(hourText);
  const minute = minuteText ? Number(minuteText) : 0;
  if (!Number.isInteger(hour12) || hour12 < 1 || hour12 > 12) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const meridiem = meridiemText.toLowerCase().replace(/\./g, '');
  if (meridiem !== 'am' && meridiem !== 'pm') return null;
  const hour24 = (hour12 % 12) + (meridiem === 'pm' ? 12 : 0);
  return { hour24, minute };
}

function parse24HourTime(
  hourText: string,
  minuteText: string,
): { hour24: number; minute: number } | null {
  const hour24 = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour24) || hour24 < 0 || hour24 > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return { hour24, minute };
}

export function normalizeTranscript(transcript: string): string {
  return transcript.replace(/\s+/g, ' ').trim();
}

function parseDeterministicTimeFromTranscript(transcript: string): DeterministicTimeParse | null {
  const t = normalizeTranscript(transcript).toLowerCase();

  const m1 = t.match(DAY_FIRST_AMPM_TIME_PATTERN);
  if (m1) {
    const dayOffset = toDayOffset(m1[1]);
    const time = parse12HourTime(m1[2] ?? '', m1[3], m1[4] ?? '');
    if (dayOffset !== null && time) return { dayOffset, ...time };
  }

  const m2 = t.match(AMPM_TIME_DAY_FIRST_PATTERN);
  if (m2) {
    const dayOffset = toDayOffset(m2[4]);
    const time = parse12HourTime(m2[1] ?? '', m2[2], m2[3] ?? '');
    if (dayOffset !== null && time) return { dayOffset, ...time };
  }

  const m3 = t.match(DAY_FIRST_24H_TIME_PATTERN);
  if (m3) {
    const dayOffset = toDayOffset(m3[1]);
    const time = parse24HourTime(m3[2] ?? '', m3[3] ?? '');
    if (dayOffset !== null && time) return { dayOffset, ...time };
  }

  const m4 = t.match(H24_TIME_DAY_FIRST_PATTERN);
  if (m4) {
    const dayOffset = toDayOffset(m4[3]);
    const time = parse24HourTime(m4[1] ?? '', m4[2] ?? '');
    if (dayOffset !== null && time) return { dayOffset, ...time };
  }

  return null;
}

function parseDeterministicReminderEpochMs(input: {
  transcript: string;
  nowEpochMs: number;
  timezone: string;
}): number | null {
  if (!isValidTimezone(input.timezone)) return null;
  const parsedTime = parseDeterministicTimeFromTranscript(input.transcript);
  if (!parsedTime) return null;
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
  if (!Number.isFinite(reminderAtEpochMs) || reminderAtEpochMs <= input.nowEpochMs) return null;
  return reminderAtEpochMs;
}

function capitalizeFirstLetter(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function extractActionFromReminderTranscript(transcript: string): string | null {
  const normalized = normalizeTranscript(transcript);
  const withoutPrefix = normalized.replace(REMINDER_COMMAND_PREFIX, '');
  if (withoutPrefix === normalized) return null;
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
  const t = normalizeTranscript(input.transcript).toLowerCase();

  const everyCountMatch = t.match(/\bevery\s+(\d+)\s+(minutes?|days?|weeks?|months?)\b/i);
  if (everyCountMatch) {
    const interval = Number(everyCountMatch[1]);
    const unit = everyCountMatch[2]?.toLowerCase() ?? '';
    if (!Number.isInteger(interval) || interval < 1) return null;
    if (unit.startsWith('day')) return { kind: 'daily', interval };
    if (unit.startsWith('week')) {
      const parts = datePartsInTimezone(input.reminderAtEpochMs, input.timezone);
      return { kind: 'weekly', interval, weekdays: [parts.weekday] };
    }
    if (unit.startsWith('month')) return { kind: 'monthly', interval, mode: 'day_of_month' };
    if (unit.startsWith('minute')) return { kind: 'custom', interval, frequency: 'minutes' };
  }

  if (/\brepeat\s+daily\b/i.test(t) || /\bevery\s+day\b/i.test(t) || /\beveryday\b/i.test(t)) {
    return { kind: 'daily', interval: 1 };
  }
  if (/\brepeat\s+weekly\b/i.test(t) || /\bevery\s+week\b/i.test(t)) {
    const parts = datePartsInTimezone(input.reminderAtEpochMs, input.timezone);
    return { kind: 'weekly', interval: 1, weekdays: [parts.weekday] };
  }
  if (/\brepeat\s+monthly\b/i.test(t) || /\bevery\s+month\b/i.test(t)) {
    return { kind: 'monthly', interval: 1, mode: 'day_of_month' };
  }
  return null;
}

function parseDeterministicDraftExtraction(input: {
  transcript: string;
  nowEpochMs: number;
  timezone: string;
}): DeterministicDraftExtraction {
  const normalized = normalizeTranscript(input.transcript);
  const action = extractActionFromReminderTranscript(normalized);
  const reminderAtEpochMs = parseDeterministicReminderEpochMs({
    transcript: normalized,
    nowEpochMs: input.nowEpochMs,
    timezone: input.timezone,
  });
  const repeat =
    reminderAtEpochMs !== null
      ? parseDeterministicRepeatRule({
          transcript: normalized,
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
  if (missingFields.includes('reminder')) return 'What time should I use for the reminder?';
  if (missingFields.includes('repeat')) return 'Should this reminder repeat, and how often?';
  if (missingFields.includes('content')) return 'What details should be included in the note?';
  return 'Could you clarify the missing detail?';
}

function normalizeClarificationFields(value: unknown): ClarificationField[] {
  if (!Array.isArray(value)) return [];
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
  if (!isRecord(rawRepeat)) return null;
  const kind = typeof rawRepeat.kind === 'string' ? rawRepeat.kind : null;
  const interval =
    typeof rawRepeat.interval === 'number' && rawRepeat.interval >= 1
      ? Math.floor(rawRepeat.interval)
      : 1;
  if (kind === 'daily') return { kind: 'daily', interval };
  if (kind === 'weekly') {
    const rawWeekdays = rawRepeat.weekdays;
    const weekdays = Array.isArray(rawWeekdays)
      ? (rawWeekdays as unknown[])
          .map((d) => Number(d))
          .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      : null;
    if (!weekdays || weekdays.length === 0) {
      const parts = datePartsInTimezone(triggerAt, 'UTC');
      return { kind: 'weekly', interval, weekdays: [parts.weekday] };
    }
    return {
      kind: 'weekly',
      interval,
      weekdays: Array.from(new Set(weekdays)).sort((a, b) => a - b),
    };
  }
  if (kind === 'monthly') return { kind: 'monthly', interval, mode: 'day_of_month' };
  if (kind === 'custom') {
    const freq = rawRepeat.frequency;
    const validFrequencies = ['minutes', 'days', 'weeks', 'months'] as const;
    type Freq = (typeof validFrequencies)[number];
    const frequency: Freq = validFrequencies.includes(freq as Freq) ? (freq as Freq) : 'days';
    return { kind: 'custom', interval, frequency };
  }
  return null;
}

type ParsedAiReminder =
  | { status: 'missing' }
  | { status: 'invalid' }
  | { status: 'valid'; epochMs: number };

function parseAiReminder(rawReminder: unknown, timezone: string): ParsedAiReminder {
  if (rawReminder === null || rawReminder === undefined) return { status: 'missing' };
  if (!isRecord(rawReminder)) return { status: 'invalid' };
  const dateStr = typeof rawReminder.date === 'string' ? rawReminder.date : null;
  const timeStr = typeof rawReminder.time === 'string' ? rawReminder.time : null;
  if (!dateStr || !timeStr) return { status: 'invalid' };
  const dateMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = timeStr.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!dateMatch || !timeMatch) return { status: 'invalid' };
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
    !Number.isInteger(second) ||
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
  if (!Number.isFinite(epochMs)) return { status: 'invalid' };
  return { status: 'valid', epochMs };
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
    clarification: { required: false, question: null, missingFields: [] },
  };
}

export function normalizeVoiceIntentResponse(
  value: unknown,
  input: { transcript: string; nowEpochMs: number; timezone: string },
): VoiceIntentResponse {
  const normalizedTranscript = normalizeTranscript(input.transcript);
  const fallback = buildTranscriptFallbackResponse({
    transcript: normalizedTranscript,
    nowEpochMs: input.nowEpochMs,
    timezone: input.timezone,
  });

  if (!isRecord(value)) return fallback;

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
      normalizedTranscript,
    },
    confidence,
    clarification: { required, question, missingFields: required ? resolvedMissingFields : [] },
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
      confidence: { title: 1, content: 1, reminder: 1, repeat: 1 },
      clarification: { required: false, question: null, missingFields: [] },
    },
    { transcript: priorDraft.normalizedTranscript, nowEpochMs, timezone },
  );
}

// ---------------------------------------------------------------------------
// NVIDIA helpers — ported from convex/functions/aiNoteCapture.ts
// ---------------------------------------------------------------------------

function extractFirstJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // fall through
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

async function callNvidiaForJson(input: {
  model: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<unknown | null> {
  const openai = new OpenAI({
    apiKey: input.apiKey,
    baseURL: 'https://integrate.api.nvidia.com/v1',
    timeout: PROVIDER_TIMEOUT_MS,
    fetch: globalThis.fetch,
  });
  try {
    const completion = await openai.chat.completions.create({
      model: input.model,
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: input.userPrompt },
      ],
      temperature: 1,
      top_p: 0.95,
      max_tokens: 8192,
      // @ts-expect-error extra arg for nvidia api
      chat_template_kwargs: { thinking: false },
    });
    const modelText = completion.choices[0]?.message?.content;
    if (!modelText) return null;
    return extractFirstJsonObject(modelText);
  } catch (err) {
    console.error('NVIDIA API error:', err);
    return null;
  }
}

function hasProviderConfig(modelEnvKey: string): { apiKey: string; model: string } | null {
  const apiKey = process.env.NVIDIA_API_KEY;
  const model = process.env[modelEnvKey] || 'deepseek-ai/deepseek-v3.2';
  const zeroRetentionEnabled = process.env.NVIDIA_TRANSCRIPT_ZERO_RETENTION === 'true';
  if (!apiKey) {
    console.warn('NVIDIA_API_KEY is not set.');
    return null;
  }
  if (!zeroRetentionEnabled) {
    console.warn(
      'NVIDIA_TRANSCRIPT_ZERO_RETENTION is not set to "true". AI extraction disabled for privacy.',
    );
    return null;
  }
  return { apiKey, model };
}

function mergeWithPriorDraft(value: unknown, priorDraft: VoiceDraft): unknown {
  if (!isRecord(value)) {
    return {
      draft: priorDraft,
      confidence: { title: 1, content: 1, reminder: 1, repeat: 1 },
      clarification: { required: false, question: null, missingFields: [] },
    };
  }
  const draft = isRecord(value.draft) ? { ...priorDraft, ...value.draft } : priorDraft;
  return { ...value, draft };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleParse(
  args: ParseArgs,
  log: (msg: string) => void,
): Promise<VoiceIntentResponse> {
  const normalizedTranscript = normalizeTranscript(args.transcript);
  if (!normalizedTranscript) throw new Error('Transcript must not be empty');

  const provider = hasProviderConfig('NVIDIA_MODEL_PARSE');
  if (!provider) {
    log('AI Provider not configured, using deterministic fallback.');
    return buildTranscriptFallbackResponse({
      transcript: normalizedTranscript,
      nowEpochMs: args.nowEpochMs,
      timezone: args.timezone,
    });
  }

  log(`Calling AI Provider (${provider.model}) for sessionId: ${args.sessionId}`);
  let providerOutput: unknown | null = null;
  try {
    providerOutput = await callNvidiaForJson({
      model: provider.model,
      apiKey: provider.apiKey,
      systemPrompt: buildParseVoiceNoteSystemPrompt({
        timezone: args.timezone,
        nowEpochMs: args.nowEpochMs,
        locale: args.locale ?? null,
      }),
      userPrompt: buildParseVoiceNoteUserPrompt({
        sessionId: args.sessionId,
        transcript: normalizedTranscript,
      }),
    });
  } catch (err) {
    console.error('AI Provider call failed:', err);
    providerOutput = null;
  }

  if (!providerOutput) {
    return buildTranscriptFallbackResponse({
      transcript: normalizedTranscript,
      nowEpochMs: args.nowEpochMs,
      timezone: args.timezone,
    });
  }

  return normalizeVoiceIntentResponse(providerOutput, {
    transcript: normalizedTranscript,
    nowEpochMs: args.nowEpochMs,
    timezone: args.timezone,
  });
}

async function handleClarify(args: ClarifyArgs): Promise<VoiceIntentResponse> {
  const normalizedAnswer = normalizeTranscript(args.clarificationAnswer);
  if (!normalizedAnswer) throw new Error('Clarification answer must not be empty');

  const provider = hasProviderConfig('NVIDIA_MODEL_CLARIFY');
  if (!provider) {
    return normalizeClarificationFallback(args.priorDraft, args.nowEpochMs, args.timezone);
  }

  let providerOutput: unknown | null = null;
  try {
    providerOutput = await callNvidiaForJson({
      model: provider.model,
      apiKey: provider.apiKey,
      systemPrompt: buildClarificationSystemPrompt({
        timezone: args.timezone,
        nowEpochMs: args.nowEpochMs,
        locale: null,
      }),
      userPrompt: buildClarificationUserPrompt({
        sessionId: args.sessionId,
        priorDraft: args.priorDraft,
        clarificationAnswer: normalizedAnswer,
      }),
    });
  } catch {
    providerOutput = null;
  }

  if (!providerOutput) {
    return normalizeClarificationFallback(args.priorDraft, args.nowEpochMs, args.timezone);
  }

  return normalizeVoiceIntentResponse(mergeWithPriorDraft(providerOutput, args.priorDraft), {
    transcript: args.priorDraft.normalizedTranscript,
    nowEpochMs: args.nowEpochMs,
    timezone: args.timezone,
  });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export default async function main(context: AppwriteContext): Promise<void> {
  const { req, res, log, error } = context;

  const userId = req.headers['x-appwrite-user-id'];
  if (!userId) {
    return res.json({ error: 'Unauthorized' }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(req.body || '{}') as Record<string, unknown>;
  } catch {
    return res.json({ error: 'Invalid JSON body' }, 400);
  }

  const path = req.path.replace(/\/$/, '');

  try {
    if (req.method === 'POST' && path === '/parse') {
      const args = body as unknown as ParseArgs;
      if (!args.transcript || !args.sessionId || !args.timezone || !args.nowEpochMs) {
        return res.json(
          { error: 'Missing required fields: transcript, sessionId, timezone, nowEpochMs' },
          400,
        );
      }
      const result = await handleParse(args, log);
      return res.json(result);
    }

    if (req.method === 'POST' && path === '/clarify') {
      const args = body as unknown as ClarifyArgs;
      if (!args.priorDraft || !args.clarificationAnswer || !args.timezone || !args.nowEpochMs) {
        return res.json(
          {
            error: 'Missing required fields: priorDraft, clarificationAnswer, timezone, nowEpochMs',
          },
          400,
        );
      }
      const result = await handleClarify(args);
      return res.json(result);
    }

    return res.json({ error: 'Not found' }, 404);
  } catch (err) {
    error(`[ai-voice-capture] Error: ${String(err)}`);
    return res.json({ error: 'Internal server error' }, 500);
  }
}
