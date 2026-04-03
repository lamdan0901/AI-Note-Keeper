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
  json?: () => Promise<unknown>;
  headers?: Headers;
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
    delete process.env.NVIDIA_API_KEY;
    delete process.env.NVIDIA_MODEL_PARSE;
    delete process.env.NVIDIA_MODEL_CLARIFY;
    delete process.env.NVIDIA_TRANSCRIPT_ZERO_RETENTION;
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

    expect(result.draft.content).toBe(null);
    expect(result.draft.keepTranscriptInContent).toBe(true);
    expect(result.draft.normalizedTranscript).toBe('Remind me to call mom tomorrow at 7');
    expect(result.confidence.content).toBe(0);
    expect(result.clarification.required).toBe(false);
    expect(result.clarification.missingFields).toEqual([]);
  });

  test('extracts reminder time from explicit tomorrow + PM phrase when provider is not configured', async () => {
    const handler = (parseVoiceNoteIntent as unknown as { _handler: Handler })._handler;

    const result = (await handler(
      {},
      {
        ...baseRequest,
        transcript: 'remind me to eat a bread at tomorrow 7 pm',
      },
    )) as {
      draft: {
        content: string | null;
        reminderAtEpochMs: number | null;
        repeat: unknown;
      };
      clarification: { required: boolean };
    };

    expect(result.draft.content).toBe(null);
    expect(result.draft.reminderAtEpochMs).toBe(1_700_074_800_000);
    expect(result.draft.repeat).toBeNull();
    expect(result.clarification.required).toBe(false);
  });

  describe('generalized deterministic extraction', () => {
    test('extracts title from reminder command when provider is not configured', async () => {
      const handler = (parseVoiceNoteIntent as unknown as { _handler: Handler })._handler;

      const result = (await handler(
        {},
        {
          ...baseRequest,
          transcript: 'remind me to submit tax report tomorrow at 9 am',
        },
      )) as {
        draft: {
          title: string | null;
        };
      };

      expect(result.draft.title).toBe('Submit tax report');
    });

    test("supports misspelled 'tommorow' for deterministic reminder extraction", async () => {
      const handler = (parseVoiceNoteIntent as unknown as { _handler: Handler })._handler;

      const result = (await handler(
        {},
        {
          ...baseRequest,
          transcript: 'remind me to call mom tommorow at 7 pm',
        },
      )) as {
        draft: {
          reminderAtEpochMs: number | null;
        };
      };

      expect(result.draft.reminderAtEpochMs).toBe(1_700_074_800_000);
    });

    test("extracts reminder time from '7:00 p.m. tomorrow' phrase", async () => {
      const handler = (parseVoiceNoteIntent as unknown as { _handler: Handler })._handler;

      const result = (await handler(
        {},
        {
          ...baseRequest,
          transcript: 'do exercise 7:00 p.m. tomorrow',
        },
      )) as {
        draft: {
          reminderAtEpochMs: number | null;
        };
      };

      expect(result.draft.reminderAtEpochMs).toBe(1_700_074_800_000);
    });

    test("extracts reminder time from 'tomorrow 7:00 p.m.' phrase", async () => {
      const handler = (parseVoiceNoteIntent as unknown as { _handler: Handler })._handler;

      const result = (await handler(
        {},
        {
          ...baseRequest,
          transcript: 'do exercise tomorrow 7:00 p.m.',
        },
      )) as {
        draft: {
          reminderAtEpochMs: number | null;
        };
      };

      expect(result.draft.reminderAtEpochMs).toBe(1_700_074_800_000);
    });

    test("extracts reminder time from '7:00 a.m. tomorrow' phrase", async () => {
      const handler = (parseVoiceNoteIntent as unknown as { _handler: Handler })._handler;

      const result = (await handler(
        {},
        {
          ...baseRequest,
          transcript: 'do exercise 7:00 a.m. tomorrow',
        },
      )) as {
        draft: {
          reminderAtEpochMs: number | null;
        };
      };

      expect(result.draft.reminderAtEpochMs).toBe(1_700_031_600_000);
    });

    test("extracts reminder time from 'tomorrow 7:00 a.m.' phrase", async () => {
      const handler = (parseVoiceNoteIntent as unknown as { _handler: Handler })._handler;

      const result = (await handler(
        {},
        {
          ...baseRequest,
          transcript: 'do exercise tomorrow 7:00 a.m.',
        },
      )) as {
        draft: {
          reminderAtEpochMs: number | null;
        };
      };

      expect(result.draft.reminderAtEpochMs).toBe(1_700_031_600_000);
    });

    test('extracts reminder time from 24-hour tomorrow phrase', async () => {
      const handler = (parseVoiceNoteIntent as unknown as { _handler: Handler })._handler;

      const result = (await handler(
        {},
        {
          ...baseRequest,
          transcript: 'remind me to call mom tomorrow at 19:30',
        },
      )) as {
        draft: {
          reminderAtEpochMs: number | null;
        };
      };

      expect(result.draft.reminderAtEpochMs).toBe(1_700_076_600_000);
    });

    test('extracts repeat daily rule from reminder command', async () => {
      const handler = (parseVoiceNoteIntent as unknown as { _handler: Handler })._handler;

      const result = (await handler(
        {},
        {
          ...baseRequest,
          transcript: 'remind me to take vitamins tomorrow at 7 pm every day',
        },
      )) as {
        draft: {
          reminderAtEpochMs: number | null;
          repeat: unknown;
        };
      };

      expect(result.draft.reminderAtEpochMs).toBe(1_700_074_800_000);
      expect(result.draft.repeat).toEqual({ kind: 'daily', interval: 1 });
    });

    test('backfills deterministic fields when provider misses title/reminder/repeat', async () => {
      process.env.NVIDIA_API_KEY = 'test-key';
      process.env.NVIDIA_MODEL_PARSE = 'gemini-2.0-flash';
      process.env.NVIDIA_TRANSCRIPT_ZERO_RETENTION = 'true';

      const providerPayload = {
        draft: {
          title: null,
          content: 'take vitamins',
          reminderAtEpochMs: null,
          repeat: null,
          keepTranscriptInContent: false,
          normalizedTranscript: 'remind me to take vitamins tomorrow at 7 pm every day',
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
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          choices: [
            {
              message: { content: JSON.stringify(providerPayload) },
            },
          ],
        }),
        text: async () =>
          JSON.stringify({
            choices: [
              {
                message: { content: JSON.stringify(providerPayload) },
              },
            ],
          }),
      });

      const handler = (parseVoiceNoteIntent as unknown as { _handler: Handler })._handler;
      const result = (await handler(
        {},
        {
          ...baseRequest,
          transcript: 'remind me to take vitamins tomorrow at 7 pm every day',
        },
      )) as {
        draft: {
          title: string | null;
          reminderAtEpochMs: number | null;
          repeat: unknown;
        };
      };

      expect(result.draft.title).toBe(null);
      expect(result.draft.reminderAtEpochMs).toBe(1_700_074_800_000);
      expect(result.draft.repeat).toEqual({ kind: 'daily', interval: 1 });
    });
  });

  test('normalizes provider output and enforces low-confidence transcript retention', async () => {
    process.env.NVIDIA_API_KEY = 'test-key';
    process.env.NVIDIA_MODEL_PARSE = 'gemini-2.0-flash';
    process.env.NVIDIA_TRANSCRIPT_ZERO_RETENTION = 'true';

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
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        choices: [
          {
            message: { content: JSON.stringify(providerPayload) },
          },
        ],
      }),
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify(providerPayload) },
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

  test('ignores repeat-only clarification requests', async () => {
    process.env.NVIDIA_API_KEY = 'test-key';
    process.env.NVIDIA_MODEL_PARSE = 'gemini-2.0-flash';
    process.env.NVIDIA_TRANSCRIPT_ZERO_RETENTION = 'true';

    const providerPayload = {
      draft: {
        title: 'Call mom',
        content: 'Call mom tomorrow morning',
        reminderAtEpochMs: 1_700_003_600_000,
        repeat: null,
        keepTranscriptInContent: false,
        normalizedTranscript: 'Remind me to call mom tomorrow at 7',
      },
      confidence: {
        title: 0.93,
        content: 0.93,
        reminder: 0.9,
        repeat: 0.2,
      },
      clarification: {
        required: true,
        question: 'Should this reminder repeat, and how often?',
        missingFields: ['repeat'],
      },
    };

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        choices: [
          {
            message: { content: JSON.stringify(providerPayload) },
          },
        ],
      }),
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify(providerPayload) },
            },
          ],
        }),
    });

    const handler = (parseVoiceNoteIntent as unknown as { _handler: Handler })._handler;
    const result = (await handler({}, baseRequest)) as {
      clarification: {
        required: boolean;
        question: string | null;
        missingFields: string[];
      };
    };

    expect(result.clarification.required).toBe(false);
    expect(result.clarification.question).toBeNull();
    expect(result.clarification.missingFields).toEqual([]);
  });

  test('still requires reminder clarification when repeat-only ask coexists with invalid reminder', async () => {
    process.env.NVIDIA_API_KEY = 'test-key';
    process.env.NVIDIA_MODEL_PARSE = 'gemini-2.0-flash';
    process.env.NVIDIA_TRANSCRIPT_ZERO_RETENTION = 'true';

    const providerPayload = {
      draft: {
        title: 'Call mom',
        content: 'Call mom tomorrow morning',
        reminder: {
          date: '2020-01-01',
          time: '07:00',
        },
        repeat: null,
        keepTranscriptInContent: false,
        normalizedTranscript: 'Remind me to call mom tomorrow at 7',
      },
      confidence: {
        title: 0.93,
        content: 0.93,
        reminder: 0.9,
        repeat: 0.2,
      },
      clarification: {
        required: true,
        question: 'Should this reminder repeat, and how often?',
        missingFields: ['repeat'],
      },
    };

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        choices: [
          {
            message: { content: JSON.stringify(providerPayload) },
          },
        ],
      }),
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify(providerPayload) },
            },
          ],
        }),
    });

    const handler = (parseVoiceNoteIntent as unknown as { _handler: Handler })._handler;
    const result = (await handler({}, baseRequest)) as {
      clarification: {
        required: boolean;
        question: string | null;
        missingFields: string[];
      };
    };

    expect(result.clarification.required).toBe(true);
    expect(result.clarification.question).toBe('What time should I use for the reminder?');
    expect(result.clarification.missingFields).toEqual(['reminder']);
  });

  test('backfills reminder time from transcript when provider misses reminder', async () => {
    process.env.NVIDIA_API_KEY = 'test-key';
    process.env.NVIDIA_MODEL_PARSE = 'gemini-2.0-flash';
    process.env.NVIDIA_TRANSCRIPT_ZERO_RETENTION = 'true';

    const providerPayload = {
      draft: {
        title: 'Eat bread',
        content: 'Eat a bread',
        reminderAtEpochMs: null,
        repeat: null,
        keepTranscriptInContent: false,
        normalizedTranscript: 'remind me to eat a bread at tomorrow 7 pm',
      },
      confidence: {
        title: 0.93,
        content: 0.9,
        reminder: 0.2,
        repeat: 0,
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
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        choices: [
          {
            message: { content: JSON.stringify(providerPayload) },
          },
        ],
      }),
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify(providerPayload) },
            },
          ],
        }),
    });

    const handler = (parseVoiceNoteIntent as unknown as { _handler: Handler })._handler;
    const result = (await handler(
      {},
      {
        ...baseRequest,
        transcript: 'remind me to eat a bread at tomorrow 7 pm',
      },
    )) as {
      draft: {
        reminderAtEpochMs: number | null;
        repeat: unknown;
      };
    };

    expect(result.draft.reminderAtEpochMs).toBe(1_700_074_800_000);
    expect(result.draft.repeat).toBeNull();
  });

  test('does not backfill reminder from provider-normalized transcript when user transcript has no reminder phrase', async () => {
    process.env.NVIDIA_API_KEY = 'test-key';
    process.env.NVIDIA_MODEL_PARSE = 'gemini-2.0-flash';
    process.env.NVIDIA_TRANSCRIPT_ZERO_RETENTION = 'true';

    const providerPayload = {
      draft: {
        title: 'Buy milk',
        content: 'Buy milk and eggs',
        reminderAtEpochMs: null,
        repeat: null,
        keepTranscriptInContent: false,
        normalizedTranscript: 'remind me to eat a bread at tomorrow 7 pm',
      },
      confidence: {
        title: 0.93,
        content: 0.9,
        reminder: 0.2,
        repeat: 0,
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
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        choices: [
          {
            message: { content: JSON.stringify(providerPayload) },
          },
        ],
      }),
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify(providerPayload) },
            },
          ],
        }),
    });

    const handler = (parseVoiceNoteIntent as unknown as { _handler: Handler })._handler;
    const result = (await handler(
      {},
      {
        ...baseRequest,
        transcript: 'buy milk and eggs',
      },
    )) as {
      draft: {
        reminderAtEpochMs: number | null;
      };
    };

    expect(result.draft.reminderAtEpochMs).toBeNull();
  });

  test('leaves content null when provider returns null content', async () => {
    process.env.NVIDIA_API_KEY = 'test-key';
    process.env.NVIDIA_MODEL_PARSE = 'gemini-2.0-flash';
    process.env.NVIDIA_TRANSCRIPT_ZERO_RETENTION = 'true';

    const providerPayload = {
      draft: {
        title: 'Buy milk',
        content: null,
        reminderAtEpochMs: null,
        repeat: null,
        keepTranscriptInContent: false,
        normalizedTranscript: 'malicious provider transcript content',
      },
      confidence: {
        title: 0.9,
        content: 0.9,
        reminder: 0,
        repeat: 0,
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
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        choices: [
          {
            message: { content: JSON.stringify(providerPayload) },
          },
        ],
      }),
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify(providerPayload) },
            },
          ],
        }),
    });

    const handler = (parseVoiceNoteIntent as unknown as { _handler: Handler })._handler;
    const result = (await handler(
      {},
      {
        ...baseRequest,
        transcript: 'buy milk and eggs',
      },
    )) as {
      draft: {
        title: string | null;
        content: string | null;
        normalizedTranscript: string;
      };
    };

    expect(result.draft.title).toBe('Buy milk');
    expect(result.draft.content).toBe(null);
    expect(result.draft.normalizedTranscript).toBe('buy milk and eggs');
  });

  test('handles invalid timezone safely when transcript contains tomorrow + PM phrase', async () => {
    const handler = (parseVoiceNoteIntent as unknown as { _handler: Handler })._handler;

    const result = (await handler(
      {},
      {
        ...baseRequest,
        transcript: 'remind me to eat a bread at tomorrow 7 pm',
        timezone: 'Invalid/Timezone',
      },
    )) as {
      draft: {
        reminderAtEpochMs: number | null;
      };
    };

    expect(result.draft.reminderAtEpochMs).toBeNull();
  });

  test('rejects invalid reminder/repeat combination and guarantees non-empty fallback content', async () => {
    process.env.NVIDIA_API_KEY = 'test-key';
    process.env.NVIDIA_MODEL_PARSE = 'gemini-2.0-flash';
    process.env.NVIDIA_TRANSCRIPT_ZERO_RETENTION = 'true';

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
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        choices: [
          {
            message: { content: JSON.stringify(providerPayload) },
          },
        ],
      }),
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify(providerPayload) },
            },
          ],
        }),
    });

    const handler = (parseVoiceNoteIntent as unknown as { _handler: Handler })._handler;
    const result = (await handler({}, baseRequest)) as {
      draft: {
        title: string | null;
        content: string | null;
        reminderAtEpochMs: number | null;
        repeat: unknown;
        keepTranscriptInContent: boolean;
      };
    };

    expect(result.draft.title).toBe('Call mom');
    expect(result.draft.content).toBeNull();
    expect(result.draft.reminderAtEpochMs).toBeNull();
    expect(result.draft.repeat).toBeNull();
    expect(result.draft.keepTranscriptInContent).toBe(true);
  });

  test('recovers reminder from transcript when provider sends stale reminder date', async () => {
    process.env.NVIDIA_API_KEY = 'test-key';
    process.env.NVIDIA_MODEL_PARSE = 'gemini-2.0-flash';
    process.env.NVIDIA_TRANSCRIPT_ZERO_RETENTION = 'true';

    const providerPayload = {
      draft: {
        title: null,
        content: 'jogging',
        reminder: {
          date: '2020-01-01',
          time: '19:00',
        },
        repeat: { kind: 'weekly', interval: 1, weekdays: [6, 0] },
        keepTranscriptInContent: false,
        normalizedTranscript: 'tomorrow 7:00 p.m. repeat every Saturday and Sunday jogging',
      },
      confidence: {
        title: 0.2,
        content: 0.8,
        reminder: 0.9,
        repeat: 0.9,
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
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        choices: [
          {
            message: { content: JSON.stringify(providerPayload) },
          },
        ],
      }),
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify(providerPayload) },
            },
          ],
        }),
    });

    const handler = (parseVoiceNoteIntent as unknown as { _handler: Handler })._handler;
    const result = (await handler(
      {},
      {
        ...baseRequest,
        transcript: 'tomorrow 7:00 p.m. repeat every Saturday and Sunday jogging',
      },
    )) as {
      draft: {
        reminderAtEpochMs: number | null;
        repeat: unknown;
      };
      clarification: {
        required: boolean;
        missingFields: string[];
      };
    };

    expect(result.draft.reminderAtEpochMs).toBe(1_700_074_800_000);
    expect(result.clarification.required).toBe(false);
    expect(result.clarification.missingFields).toEqual([]);
  });

  test('recovers reminder from transcript when provider sends impossible calendar date', async () => {
    process.env.NVIDIA_API_KEY = 'test-key';
    process.env.NVIDIA_MODEL_PARSE = 'gemini-2.0-flash';
    process.env.NVIDIA_TRANSCRIPT_ZERO_RETENTION = 'true';

    const providerPayload = {
      draft: {
        title: null,
        content: 'jogging',
        reminder: {
          date: '2026-02-31',
          time: '19:00',
        },
        repeat: { kind: 'weekly', interval: 1, weekdays: [6, 0] },
        keepTranscriptInContent: false,
        normalizedTranscript: 'tomorrow 7:00 p.m. repeat every Saturday and Sunday jogging',
      },
      confidence: {
        title: 0.2,
        content: 0.8,
        reminder: 0.9,
        repeat: 0.9,
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
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        choices: [
          {
            message: { content: JSON.stringify(providerPayload) },
          },
        ],
      }),
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify(providerPayload) },
            },
          ],
        }),
    });

    const handler = (parseVoiceNoteIntent as unknown as { _handler: Handler })._handler;
    const result = (await handler(
      {},
      {
        ...baseRequest,
        transcript: 'tomorrow 7:00 p.m. repeat every Saturday and Sunday jogging',
      },
    )) as {
      draft: {
        reminderAtEpochMs: number | null;
        repeat: unknown;
      };
      clarification: {
        required: boolean;
        missingFields: string[];
      };
    };

    expect(result.draft.reminderAtEpochMs).toBe(1_700_074_800_000);
    expect(result.clarification.required).toBe(false);
    expect(result.clarification.missingFields).toEqual([]);
  });

  test('still requires reminder clarification when provider reminder is invalid and transcript time is ambiguous', async () => {
    process.env.NVIDIA_API_KEY = 'test-key';
    process.env.NVIDIA_MODEL_PARSE = 'gemini-2.0-flash';
    process.env.NVIDIA_TRANSCRIPT_ZERO_RETENTION = 'true';

    const providerPayload = {
      draft: {
        title: null,
        content: 'have breakfast',
        reminder: {
          date: '2020-01-01',
          time: '07:00',
        },
        repeat: null,
        keepTranscriptInContent: false,
        normalizedTranscript: 'have breakfast tomorrow morning',
      },
      confidence: {
        title: 0.2,
        content: 0.8,
        reminder: 0.9,
        repeat: 0.1,
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
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        choices: [
          {
            message: { content: JSON.stringify(providerPayload) },
          },
        ],
      }),
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify(providerPayload) },
            },
          ],
        }),
    });

    const handler = (parseVoiceNoteIntent as unknown as { _handler: Handler })._handler;
    const result = (await handler(
      {},
      {
        ...baseRequest,
        transcript: 'have breakfast tomorrow morning',
      },
    )) as {
      draft: {
        reminderAtEpochMs: number | null;
      };
      clarification: {
        required: boolean;
        missingFields: string[];
      };
    };

    expect(result.draft.reminderAtEpochMs).toBeNull();
    expect(result.clarification.required).toBe(true);
    expect(result.clarification.missingFields).toContain('reminder');
  });

  test('continue clarification falls back to prior draft on malformed provider output', async () => {
    process.env.NVIDIA_API_KEY = 'test-key';
    process.env.NVIDIA_MODEL_CLARIFY = 'gemini-2.0-flash';
    process.env.NVIDIA_TRANSCRIPT_ZERO_RETENTION = 'true';

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        choices: [
          {
            message: { content: '{}' },
          },
        ],
      }),
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
