import main, {
  normalizeTranscript,
  buildTranscriptFallbackResponse,
  normalizeVoiceIntentResponse,
  normalizeClarificationFallback,
} from './main.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: {
  path?: string;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}) {
  const responses: { data: unknown; status: number }[] = [];
  const logs: string[] = [];
  const errors: string[] = [];

  const res = {
    json(data: unknown, statusCode = 200) {
      responses.push({ data, status: statusCode });
    },
  };

  return {
    req: {
      method: overrides.method ?? 'POST',
      path: overrides.path ?? '/',
      headers: overrides.headers ?? { 'x-appwrite-user-id': 'user123' },
      body: overrides.body ?? '{}',
      query: {},
    },
    res,
    log: (msg: string) => logs.push(msg),
    error: (msg: string) => errors.push(msg),
    getLastResponse: () => responses[responses.length - 1],
    logs,
    errors,
  };
}

const NOW_MS = 1_750_000_000_000; // arbitrary future timestamp
const TIMEZONE = 'America/New_York';

// ---------------------------------------------------------------------------
// Unit helpers (not HTTP)
// ---------------------------------------------------------------------------

describe('normalizeTranscript', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeTranscript('  hello   world  ')).toBe('hello world');
  });
});

describe('buildTranscriptFallbackResponse', () => {
  it('returns a valid VoiceIntentResponse with zero confidence', () => {
    const result = buildTranscriptFallbackResponse({
      transcript: 'take out the trash',
      nowEpochMs: NOW_MS,
      timezone: TIMEZONE,
    });
    expect(result.draft.normalizedTranscript).toBe('take out the trash');
    expect(result.confidence).toEqual({ title: 0, content: 0, reminder: 0, repeat: 0 });
    expect(result.clarification.required).toBe(false);
  });
});

describe('normalizeClarificationFallback', () => {
  it('propagates the prior draft and disables clarification', () => {
    const priorDraft = {
      title: 'Buy milk',
      content: null,
      reminderAtEpochMs: null,
      repeat: null,
      keepTranscriptInContent: false,
      normalizedTranscript: 'buy milk',
    };
    const result = normalizeClarificationFallback(priorDraft, NOW_MS, TIMEZONE);
    expect(result.draft.title).toBe('Buy milk');
    expect(result.clarification.required).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HTTP handler — 401 guard
// ---------------------------------------------------------------------------

describe('main — auth guard', () => {
  it('returns 401 when x-appwrite-user-id header is missing', async () => {
    const ctx = makeContext({ headers: {} });
    await main(ctx as Parameters<typeof main>[0]);
    expect(ctx.getLastResponse().status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// HTTP handler — /parse route
// ---------------------------------------------------------------------------

describe('main — POST /parse', () => {
  it('returns deterministic fallback when NVIDIA env vars are not set', async () => {
    // Ensure env vars are absent
    delete process.env.NVIDIA_API_KEY;
    delete process.env.NVIDIA_TRANSCRIPT_ZERO_RETENTION;

    const body = JSON.stringify({
      transcript: 'remind me to take out the trash tomorrow at 9am',
      userId: 'user123',
      timezone: TIMEZONE,
      nowEpochMs: NOW_MS,
      sessionId: 'sess-1',
    });

    const ctx = makeContext({ path: '/parse', body });
    await main(ctx as Parameters<typeof main>[0]);

    const response = ctx.getLastResponse();
    expect(response.status).toBe(200);
    const result = response.data as ReturnType<typeof buildTranscriptFallbackResponse>;
    expect(result.draft).toBeDefined();
    expect(result.confidence).toBeDefined();
    expect(result.clarification).toBeDefined();
    // Deterministic fallback: low confidence
    expect(result.confidence.title).toBe(0);
    expect(result.confidence.reminder).toBe(0);
  });

  it('returns 400 when required fields are missing', async () => {
    const ctx = makeContext({ path: '/parse', body: JSON.stringify({ transcript: 'test' }) });
    await main(ctx as Parameters<typeof main>[0]);
    expect(ctx.getLastResponse().status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// HTTP handler — /parse with mocked NVIDIA
// ---------------------------------------------------------------------------

describe('main — POST /parse with mocked NVIDIA response', () => {
  beforeEach(() => {
    process.env.NVIDIA_API_KEY = 'test-key';
    process.env.NVIDIA_TRANSCRIPT_ZERO_RETENTION = 'true';
    process.env.NVIDIA_MODEL_PARSE = 'test-model';
  });

  afterEach(() => {
    delete process.env.NVIDIA_API_KEY;
    delete process.env.NVIDIA_TRANSCRIPT_ZERO_RETENTION;
    delete process.env.NVIDIA_MODEL_PARSE;
    jest.restoreAllMocks();
  });

  it('returns normalised VoiceIntentResponse from AI output', async () => {
    // Mock the OpenAI module to return controlled JSON
    const mockAiOutput = {
      draft: {
        title: 'Take out the trash',
        content: null,
        reminder: null,
        repeat: null,
        keepTranscriptInContent: false,
        normalizedTranscript: 'take out the trash',
      },
      confidence: { title: 0.9, content: 0, reminder: 0, repeat: 0 },
      clarification: { required: false, question: null, missingFields: [] },
    };

    // Spy on OpenAI by dynamically mocking via module-level override in test env
    // We intercept callNvidiaForJson indirectly by mocking globalThis.fetch
    const fakeResponse = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(mockAiOutput) } }],
      }),
    };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(fakeResponse as Response);

    const body = JSON.stringify({
      transcript: 'take out the trash',
      userId: 'user123',
      timezone: TIMEZONE,
      nowEpochMs: NOW_MS,
      sessionId: 'sess-2',
    });

    const ctx = makeContext({ path: '/parse', body });
    await main(ctx as Parameters<typeof main>[0]);

    expect(fetchSpy).toHaveBeenCalled();
    const response = ctx.getLastResponse();
    expect(response.status).toBe(200);
    const result = response.data as ReturnType<typeof normalizeVoiceIntentResponse>;
    expect(result.draft).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// HTTP handler — /clarify route
// ---------------------------------------------------------------------------

describe('main — POST /clarify', () => {
  it('returns clarification fallback when NVIDIA is not configured', async () => {
    delete process.env.NVIDIA_API_KEY;
    delete process.env.NVIDIA_TRANSCRIPT_ZERO_RETENTION;

    const priorDraft = {
      title: 'Doctor appointment',
      content: null,
      reminderAtEpochMs: null,
      repeat: null,
      keepTranscriptInContent: false,
      normalizedTranscript: 'doctor appointment',
    };

    const body = JSON.stringify({
      sessionId: 'sess-3',
      priorDraft,
      clarificationAnswer: 'tomorrow at 3pm',
      timezone: TIMEZONE,
      nowEpochMs: NOW_MS,
    });

    const ctx = makeContext({ path: '/clarify', body });
    await main(ctx as Parameters<typeof main>[0]);

    const response = ctx.getLastResponse();
    expect(response.status).toBe(200);
    const result = response.data as ReturnType<typeof normalizeClarificationFallback>;
    expect(result.draft.title).toBe('Doctor appointment');
    expect(result.clarification.required).toBe(false);
  });

  it('returns 400 when required fields are missing', async () => {
    const ctx = makeContext({ path: '/clarify', body: JSON.stringify({ sessionId: 'sess-4' }) });
    await main(ctx as Parameters<typeof main>[0]);
    expect(ctx.getLastResponse().status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 404 for unknown routes
// ---------------------------------------------------------------------------

describe('main — unknown route', () => {
  it('returns 404', async () => {
    const ctx = makeContext({ path: '/unknown' });
    await main(ctx as Parameters<typeof main>[0]);
    expect(ctx.getLastResponse().status).toBe(404);
  });
});
