import { beforeEach, describe, expect, jest, test } from '@jest/globals';

type HandlerConfig = {
  handler: (...args: unknown[]) => unknown;
  [key: string]: unknown;
};

type Handler = (ctx: Record<string, never>, args: Record<string, unknown>) => Promise<unknown>;

const mockAction = jest.fn((config: HandlerConfig) => ({
  ...config,
  _handler: config.handler,
}));

jest.mock(
  '../../convex/_generated/server',
  () => ({
    action: mockAction,
  }),
  { virtual: true },
);

jest.mock(
  'convex/values',
  () => {
    const v: Record<string, jest.Mock> = {};
    const pass = () => ({});
    ['string', 'number', 'boolean', 'any', 'null'].forEach((k) => (v[k] = jest.fn(pass)));
    v['optional'] = jest.fn(pass);
    v['union'] = jest.fn(pass);
    v['array'] = jest.fn(pass);
    v['object'] = jest.fn(pass);
    v['literal'] = jest.fn(pass);
    return { v };
  },
  { virtual: true },
);

type FetchResponse = {
  ok: boolean;
  text: () => Promise<string>;
  status: number;
};

const mockFetch = jest.fn<() => Promise<FetchResponse>>();
Object.defineProperty(globalThis, 'fetch', {
  value: mockFetch,
  writable: true,
});

import {
  continueVoiceClarification,
  parseVoiceNoteIntent,
} from '../../convex/functions/aiNoteCapture';

const baseRequest = {
  transcript: 'Remind me to call mom tomorrow at 7',
  userId: 'user-1',
  timezone: 'UTC',
  nowEpochMs: 1_700_000_000_000,
  locale: 'en-US',
  sessionId: 'session-1',
};

describe('aiNoteCapture Contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL_PARSE;
    delete process.env.GEMINI_MODEL_CLARIFY;
    delete process.env.GEMINI_TRANSCRIPT_ZERO_RETENTION;
  });

  test('returns deterministic transcript fallback when provider is not configured', async () => {
    const handler = (parseVoiceNoteIntent as unknown as { _handler: Handler })._handler;

    const result = (await handler({}, baseRequest)) as {
      draft: {
        content: string | null;
        keepTranscriptInContent: boolean;
        normalizedTranscript: string;
      };
      confidence: { content: number };
      clarification: { required: boolean; missingFields: string[] };
    };

    expect(result.draft.content).toBe('Remind me to call mom tomorrow at 7');
    expect(result.draft.keepTranscriptInContent).toBe(true);
    expect(result.draft.normalizedTranscript).toBe('Remind me to call mom tomorrow at 7');
    expect(result.confidence.content).toBe(0);
    expect(result.clarification.required).toBe(false);
    expect(result.clarification.missingFields).toEqual([]);
  });

  test('normalizes provider output and enforces low-confidence transcript retention', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_MODEL_PARSE = 'gemini-2.0-flash';
    process.env.GEMINI_TRANSCRIPT_ZERO_RETENTION = 'true';

    const providerPayload = {
      draft: {
        title: 'Call mom',
        content: 'Call mom about travel plans',
        reminderAtEpochMs: 1_700_003_600_000,
        repeat: { kind: 'weekly', interval: 1, weekdays: [1] },
        keepTranscriptInContent: false,
        normalizedTranscript: 'Remind me to call mom tomorrow at 7',
      },
      confidence: {
        title: 0.93,
        content: 0.42,
        reminder: 0.88,
        repeat: 0.91,
      },
      clarification: {
        required: false,
        question: null,
        missingFields: [],
      },
    };

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(providerPayload) }],
              },
            },
          ],
        }),
    });

    const handler = (parseVoiceNoteIntent as unknown as { _handler: Handler })._handler;
    const result = (await handler({}, baseRequest)) as {
      draft: {
        keepTranscriptInContent: boolean;
        reminderAtEpochMs: number | null;
        repeat: unknown;
      };
    };

    expect(result.draft.keepTranscriptInContent).toBe(true);
    expect(result.draft.reminderAtEpochMs).toBe(1_700_003_600_000);
    expect(result.draft.repeat).toEqual({ kind: 'weekly', interval: 1, weekdays: [1] });
  });

  test('rejects invalid reminder/repeat combination and guarantees non-empty fallback content', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_MODEL_PARSE = 'gemini-2.0-flash';
    process.env.GEMINI_TRANSCRIPT_ZERO_RETENTION = 'true';

    const providerPayload = {
      draft: {
        title: '',
        content: '',
        reminderAtEpochMs: 1_699_999_999_000,
        repeat: { kind: 'daily', interval: 1 },
        keepTranscriptInContent: false,
        normalizedTranscript: '',
      },
      confidence: {
        title: 0.3,
        content: 0.1,
        reminder: 0.7,
        repeat: 0.8,
      },
      clarification: {
        required: false,
        question: null,
        missingFields: [],
      },
    };

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(providerPayload) }],
              },
            },
          ],
        }),
    });

    const handler = (parseVoiceNoteIntent as unknown as { _handler: Handler })._handler;
    const result = (await handler({}, baseRequest)) as {
      draft: {
        content: string | null;
        reminderAtEpochMs: number | null;
        repeat: unknown;
        keepTranscriptInContent: boolean;
      };
    };

    expect(result.draft.content).toBe('Remind me to call mom tomorrow at 7');
    expect(result.draft.reminderAtEpochMs).toBeNull();
    expect(result.draft.repeat).toBeNull();
    expect(result.draft.keepTranscriptInContent).toBe(true);
  });

  test('continue clarification falls back to prior draft on malformed provider output', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_MODEL_CLARIFY = 'gemini-2.0-flash';
    process.env.GEMINI_TRANSCRIPT_ZERO_RETENTION = 'true';

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{not-json',
    });

    const handler = (continueVoiceClarification as unknown as { _handler: Handler })._handler;
    const result = (await handler(
      {},
      {
        sessionId: 'session-1',
        clarificationAnswer: '7 PM',
        timezone: 'UTC',
        nowEpochMs: 1_700_000_000_000,
        priorDraft: {
          title: 'Call mom',
          content: 'Call mom',
          reminderAtEpochMs: 1_700_003_600_000,
          repeat: null,
          keepTranscriptInContent: false,
          normalizedTranscript: 'Remind me to call mom tomorrow at 7',
        },
      },
    )) as {
      draft: { title: string | null; reminderAtEpochMs: number | null };
      clarification: { required: boolean };
    };

    expect(result.draft.title).toBe('Call mom');
    expect(result.draft.reminderAtEpochMs).toBe(1_700_003_600_000);
    expect(result.clarification.required).toBe(false);
  });
});
