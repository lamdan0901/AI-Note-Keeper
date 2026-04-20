import assert from 'node:assert/strict';
import test from 'node:test';

import { createAiService } from '../../ai/service.js';
import type {
  ContinueVoiceClarificationRequest,
  ParseVoiceNoteIntentRequest,
} from '../../ai/contracts.js';

const baseParseRequest: ParseVoiceNoteIntentRequest = {
  transcript: 'remind me to call mom tomorrow at 7 pm every day',
  userId: 'user-1',
  timezone: 'UTC',
  nowEpochMs: 1_700_000_000_000,
  locale: 'en-US',
  sessionId: 'session-1',
};

const baseClarifyRequest: ContinueVoiceClarificationRequest = {
  sessionId: 'session-1',
  priorDraft: {
    title: 'Call mom',
    content: null,
    reminderAtEpochMs: 1_700_074_800_000,
    repeat: { kind: 'daily', interval: 1 },
    keepTranscriptInContent: true,
    normalizedTranscript: 'remind me to call mom tomorrow at 7 pm every day',
  },
  clarificationAnswer: 'daily',
  timezone: 'UTC',
  nowEpochMs: 1_700_000_000_000,
};

test('parseVoiceNoteIntent fallback returns DTO-compatible shape for clients', async () => {
  const service = createAiService({
    readProviderConfig: () => null,
  });

  const result = await service.parseVoiceNoteIntent(baseParseRequest);

  assert.equal(typeof result.draft.keepTranscriptInContent, 'boolean');
  assert.equal(typeof result.draft.normalizedTranscript, 'string');
  assert.equal(typeof result.confidence.title, 'number');
  assert.equal(typeof result.confidence.content, 'number');
  assert.equal(Array.isArray(result.clarification.missingFields), true);
});

test('normalization backfills title/reminder/repeat when provider omits deterministic fields', async () => {
  const service = createAiService({
    readProviderConfig: () => ({
      apiKey: 'test',
      parseModel: 'parse-model',
      clarifyModel: 'clarify-model',
    }),
    callProviderJson: async () => ({
      draft: {
        title: null,
        content: 'take vitamins',
        reminderAtEpochMs: null,
        repeat: null,
        keepTranscriptInContent: false,
      },
      confidence: {
        title: 0.1,
        content: 0.95,
        reminder: 0.1,
        repeat: 0.1,
      },
      clarification: {
        required: false,
        question: null,
        missingFields: [],
      },
    }),
  });

  const result = await service.parseVoiceNoteIntent({
    ...baseParseRequest,
    transcript: 'remind me to take vitamins tomorrow at 7 pm every day',
  });

  assert.equal(result.draft.title, 'Take vitamins');
  assert.equal(result.draft.reminderAtEpochMs, 1_700_074_800_000);
  assert.deepEqual(result.draft.repeat, { kind: 'daily', interval: 1 });
});

test('clarification normalization suppresses repeat-only clarification requests', async () => {
  const service = createAiService({
    readProviderConfig: () => ({
      apiKey: 'test',
      parseModel: 'parse-model',
      clarifyModel: 'clarify-model',
    }),
    callProviderJson: async () => ({
      draft: {
        title: 'Call mom',
        content: null,
        reminderAtEpochMs: 1_700_074_800_000,
        repeat: { kind: 'daily', interval: 1 },
        keepTranscriptInContent: false,
      },
      confidence: {
        title: 1,
        content: 1,
        reminder: 1,
        repeat: 1,
      },
      clarification: {
        required: true,
        question: 'Should this repeat?',
        missingFields: ['repeat'],
      },
    }),
  });

  const result = await service.continueVoiceClarification(baseClarifyRequest);

  assert.equal(result.clarification.required, false);
  assert.equal(result.clarification.question, null);
  assert.deepEqual(result.clarification.missingFields, []);
});

test('missing provider config and provider failures always return deterministic fallback', async () => {
  const noConfigService = createAiService({
    readProviderConfig: () => null,
  });

  const failedProviderService = createAiService({
    readProviderConfig: () => ({
      apiKey: 'test',
      parseModel: 'parse-model',
      clarifyModel: 'clarify-model',
    }),
    callProviderJson: async () => {
      throw new Error('timeout');
    },
  });

  const noConfigResult = await noConfigService.parseVoiceNoteIntent(baseParseRequest);
  const failedResult = await failedProviderService.parseVoiceNoteIntent(baseParseRequest);

  assert.equal(noConfigResult.draft.normalizedTranscript, failedResult.draft.normalizedTranscript);
  assert.equal(noConfigResult.clarification.required, false);
  assert.equal(failedResult.clarification.required, false);
});

test('provider success path still passes through normalization and confidence clamping', async () => {
  const service = createAiService({
    readProviderConfig: () => ({
      apiKey: 'test',
      parseModel: 'parse-model',
      clarifyModel: 'clarify-model',
    }),
    callProviderJson: async () => ({
      draft: {
        title: 'Weekly review',
        content: 'go through tasks',
        reminderAtEpochMs: 1_700_100_000_000,
        repeat: { kind: 'weekly', interval: 1, weekdays: [1] },
        keepTranscriptInContent: false,
      },
      confidence: {
        title: 4,
        content: -1,
        reminder: 0.8,
        repeat: 0.9,
      },
      clarification: {
        required: false,
        question: null,
        missingFields: [],
      },
    }),
  });

  const result = await service.parseVoiceNoteIntent({
    ...baseParseRequest,
    transcript: 'weekly review tomorrow at 7 pm',
  });

  assert.equal(result.confidence.title, 1);
  assert.equal(result.confidence.content, 0);
  assert.equal(result.draft.reminderAtEpochMs, 1_700_100_000_000);
  assert.deepEqual(result.draft.repeat, { kind: 'weekly', interval: 1, weekdays: [1] });
});
