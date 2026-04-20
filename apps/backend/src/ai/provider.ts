type ProviderInput = Readonly<{
  model: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}>;

const DEFAULT_TIMEOUT_MS = 25_000;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => {
  return typeof value === 'object' && value !== null;
};

const extractFirstJsonObject = (text: string): unknown | null => {
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

  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
};

export const callNvidiaProviderJson = async (input: ProviderInput): Promise<unknown | null> => {
  const requestFetch = input.fetchImpl ?? fetch;
  const response = await requestFetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model,
      temperature: 1,
      top_p: 0.95,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: input.userPrompt },
      ],
      chat_template_kwargs: { thinking: false },
    }),
    signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as unknown;
  if (!isRecord(payload)) {
    return null;
  }

  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const first = choices[0];
  if (!isRecord(first) || !isRecord(first.message)) {
    return null;
  }

  const content = first.message.content;
  if (typeof content !== 'string') {
    return null;
  }

  return extractFirstJsonObject(content);
};
