import type { VoiceDraft } from './aiSchemas';

type PromptContext = {
  timezone: string;
  nowEpochMs: number;
  locale: string | null;
};

function formatNow(nowEpochMs: number): string {
  return new Date(nowEpochMs).toISOString();
}

function localeInstruction(locale: string | null): string {
  return locale ? `User locale: ${locale}.` : 'User locale is unknown.';
}

export function buildParseVoiceNoteSystemPrompt(context: PromptContext): string {
  return [
    'You extract a structured note draft from a voice transcript.',
    'Return JSON only, with no markdown and no extra keys.',
    'Use this exact JSON shape:',
    '{"draft":{"title":string|null,"content":string|null,"reminder":{"date":string,"time":string}|null,"repeat":RepeatRule|null,"keepTranscriptInContent":boolean,"normalizedTranscript":string},"confidence":{"title":number,"content":number,"reminder":number,"repeat":number},"clarification":{"required":boolean,"question":string|null,"missingFields":["title"|"content"|"reminder"|"repeat"]}}',
    'reminder.date must be YYYY-MM-DD and reminder.time must be HH:mm (24-hour) in the user\'s local time.',
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

export function buildParseVoiceNoteUserPrompt(input: {
  sessionId: string;
  transcript: string;
}): string {
  return [`SessionId: ${input.sessionId}`, 'Transcript:', input.transcript].join('\n');
}

export function buildClarificationSystemPrompt(context: PromptContext): string {
  return [
    'You update an existing note draft using a clarification answer.',
    'Return JSON only, with the same schema as the parse response.',
    'Schema reminder:',
    '{"draft":{"title":string|null,"content":string|null,"reminder":{"date":string,"time":string}|null,"repeat":RepeatRule|null,"keepTranscriptInContent":boolean,"normalizedTranscript":string},...}',
    'reminder.date must be YYYY-MM-DD and reminder.time must be HH:mm (24-hour) in the user\'s local time.',
    `Reference timezone: ${context.timezone}.`,
    `Reference time (ISO): ${formatNow(context.nowEpochMs)}.`,
    localeInstruction(context.locale),
    'If reminderAtEpochMs is null then repeat must be null.',
    'Only keep clarification.required=true when essential data is still missing.',
    'Extract only the user\'s note intent for title/content, omitting timing/reminder details.',
    'If the extracted intent is short, put it in the title and set content to null.',
    'If the extracted intent is long, put it in the content and set title to null.',
  ].join('\n');
}

export function buildClarificationUserPrompt(input: {
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
