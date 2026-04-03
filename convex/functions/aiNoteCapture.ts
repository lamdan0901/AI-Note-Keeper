'use node';

import OpenAI from 'openai';
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

const PROVIDER_TIMEOUT_MS = 25_000;

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
    if (!modelText) {
      return null;
    }

    const parsed = extractFirstJsonObject(modelText);
    return parsed;
  } catch (error) {
    console.error('NVIDIA API error:', error);
    return null;
  }
}

function hasProviderConfig(modelEnv: string): { apiKey: string; model: string } | null {
  const apiKey = process.env.NVIDIA_API_KEY;
  const model = process.env[modelEnv] || 'deepseek-ai/deepseek-v3.2';
  const zeroRetentionEnabled = process.env.NVIDIA_TRANSCRIPT_ZERO_RETENTION === 'true';

  if (!apiKey) {
    console.warn('NVIDIA_API_KEY is not set.');
    return null;
  }
  if (!zeroRetentionEnabled) {
    console.warn('NVIDIA_TRANSCRIPT_ZERO_RETENTION is not set to "true". AI extraction disabled for privacy.');
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

    const provider = hasProviderConfig('NVIDIA_MODEL_PARSE');
    if (!provider) {
      console.log('AI Provider not configured, using deterministic fallback.');
      return buildTranscriptFallbackResponse({
        transcript: normalizedTranscript,
        nowEpochMs: args.nowEpochMs,
        timezone: args.timezone,
      });
    }

    console.log(`Calling AI Provider (${provider.model}) for sessionId: ${args.sessionId}`);
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
      console.log('AI Provider Output:', JSON.stringify(providerOutput, null, 2));
    } catch (error) {
      console.error('AI Provider call failed:', error);
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
  },
});

export const continueVoiceClarification = action({
  args: continueVoiceClarificationArgsValidator,
  handler: async (_ctx, args) => {
    const normalizedAnswer = normalizeTranscript(args.clarificationAnswer);
    if (!normalizedAnswer) {
      throw new Error('Clarification answer must not be empty');
    }

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
  },
});
