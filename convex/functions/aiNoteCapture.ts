'use node';

import { action } from '../_generated/server';
import {
  continueVoiceClarificationArgsValidator,
  type VoiceDraft,
  buildTranscriptFallbackResponse,
  normalizeClarificationFallback,
  normalizeTranscript,
  normalizeVoiceIntentResponse,
  parseVoiceNoteIntentArgsValidator,
} from './aiSchemas';
import {
  buildClarificationSystemPrompt,
  buildClarificationUserPrompt,
  buildParseVoiceNoteSystemPrompt,
  buildParseVoiceNoteUserPrompt,
} from './aiPrompts';

type GeminiTextPart = {
  text?: string;
};

type GeminiCandidate = {
  content?: {
    parts?: GeminiTextPart[];
  };
};

const GEMINI_ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const PROVIDER_TIMEOUT_MS = 12_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractFirstJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // Continue with substring extraction.
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }

  const maybeJson = trimmed.slice(start, end + 1);
  try {
    return JSON.parse(maybeJson) as unknown;
  } catch {
    return null;
  }
}

function extractGeminiText(responseText: string): string | null {
  const parsed = extractFirstJsonObject(responseText);
  if (!isRecord(parsed)) {
    return responseText;
  }

  const candidates = parsed.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return responseText;
  }

  const first = candidates[0] as GeminiCandidate | undefined;
  const parts = first?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return responseText;
  }

  const textPart = parts.find((part) => typeof part?.text === 'string');
  return textPart?.text ?? responseText;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callGeminiForJson(input: {
  model: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<unknown | null> {
  const endpoint = `${GEMINI_ENDPOINT_BASE}/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(input.apiKey)}`;

  const response = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          role: 'system',
          parts: [{ text: input.systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: input.userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    },
    PROVIDER_TIMEOUT_MS,
  );

  if (!response.ok) {
    return null;
  }

  const body = await response.text();
  const modelText = extractGeminiText(body);
  if (!modelText) {
    return null;
  }

  return extractFirstJsonObject(modelText);
}

function hasProviderConfig(modelEnv: string): { apiKey: string; model: string } | null {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env[modelEnv];
  const zeroRetentionEnabled = process.env.GEMINI_TRANSCRIPT_ZERO_RETENTION === 'true';

  if (!apiKey || !model || !zeroRetentionEnabled) {
    return null;
  }

  return { apiKey, model };
}

function mergeWithPriorDraft(value: unknown, priorDraft: VoiceDraft): unknown {
  if (!isRecord(value)) {
    return {
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
    };
  }

  const draft = isRecord(value.draft)
    ? {
        ...priorDraft,
        ...value.draft,
      }
    : priorDraft;

  return {
    ...value,
    draft,
  };
}

export const parseVoiceNoteIntent = action({
  args: parseVoiceNoteIntentArgsValidator,
  handler: async (_ctx, args) => {
    const normalizedTranscript = normalizeTranscript(args.transcript);
    if (!normalizedTranscript) {
      throw new Error('Transcript must not be empty');
    }

    const provider = hasProviderConfig('GEMINI_MODEL_PARSE');
    if (!provider) {
      return buildTranscriptFallbackResponse(normalizedTranscript);
    }

    let providerOutput: unknown | null = null;

    try {
      providerOutput = await callGeminiForJson({
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
    } catch {
      providerOutput = null;
    }

    if (!providerOutput) {
      return buildTranscriptFallbackResponse(normalizedTranscript);
    }

    return normalizeVoiceIntentResponse(providerOutput, {
      transcript: normalizedTranscript,
      nowEpochMs: args.nowEpochMs,
    });
  },
});

export const continueVoiceClarification = action({
  args: continueVoiceClarificationArgsValidator,
  handler: async (_ctx, args) => {
    const normalizedAnswer = normalizeTranscript(args.clarificationAnswer);
    if (!normalizedAnswer) {
      throw new Error('Clarification answer must not be empty');
    }

    const provider = hasProviderConfig('GEMINI_MODEL_CLARIFY');
    if (!provider) {
      return normalizeClarificationFallback(args.priorDraft, args.nowEpochMs);
    }

    let providerOutput: unknown | null = null;

    try {
      providerOutput = await callGeminiForJson({
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
      return normalizeClarificationFallback(args.priorDraft, args.nowEpochMs);
    }

    return normalizeVoiceIntentResponse(mergeWithPriorDraft(providerOutput, args.priorDraft), {
      transcript: args.priorDraft.normalizedTranscript,
      nowEpochMs: args.nowEpochMs,
    });
  },
});
