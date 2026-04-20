export const MAX_PUSH_RETRIES = 2;
export const PUSH_RETRY_DELAYS_MS = [30_000, 60_000] as const;

export type PushRetryPolicy = Readonly<{
  maxRetries: number;
  retryDelaysMs: ReadonlyArray<number>;
}>;

export const DEFAULT_PUSH_RETRY_POLICY: PushRetryPolicy = {
  maxRetries: MAX_PUSH_RETRIES,
  retryDelaysMs: PUSH_RETRY_DELAYS_MS,
};

export type PushDeliveryToken = Readonly<{
  deviceId: string;
  fcmToken: string;
}>;

export type PushJobPayload = Readonly<{
  userId: string;
  reminderId: string;
  changeEventId: string;
  isTrigger?: boolean;
  attempt: number;
  tokens: ReadonlyArray<PushDeliveryToken>;
}>;

export type PushRetryJobPayload = Readonly<{
  userId: string;
  reminderId: string;
  changeEventId: string;
  isTrigger?: boolean;
  attempt: number;
  token: PushDeliveryToken;
}>;

export type PushDeliveryRequest = Readonly<{
  userId: string;
  reminderId: string;
  changeEventId: string;
  isTrigger?: boolean;
  attempt: number;
  token: PushDeliveryToken;
}>;

export type PushDeliveryClassification =
  | 'delivered'
  | 'transient_failure'
  | 'unregistered'
  | 'terminal_failure';

export type PushDeliveryResult = Readonly<{
  classification: PushDeliveryClassification;
  statusCode?: number;
  errorCode?: string;
  message?: string;
}>;

export type PushProviderSuccessResponse = Readonly<{
  ok: true;
}>;

export type PushProviderFailureResponse = Readonly<{
  ok: false;
  statusCode?: number;
  errorCode?: string;
  message?: string;
}>;

export type PushProviderResponse = PushProviderSuccessResponse | PushProviderFailureResponse;

export type PushProvider = Readonly<{
  sendToToken: (request: PushDeliveryRequest) => Promise<PushProviderResponse>;
}>;

export type PushDeliveryService = Readonly<{
  deliverToToken: (request: PushDeliveryRequest) => Promise<PushDeliveryResult>;
}>;

export type PushRetryScheduler = Readonly<{
  scheduleRetry: (
    input: Readonly<{ delayMs: number; job: PushRetryJobPayload; jobKey: string }>,
  ) => Promise<void>;
}>;

export type PushTerminalFailureRecord = Readonly<{
  tokenIdentity: string;
  userId: string;
  reminderId: string;
  changeEventId: string;
  attempt: number;
  statusCode?: number;
  errorCode?: string;
  reason: string;
}>;

export type PushTerminalFailureRecorder = Readonly<{
  record: (failure: PushTerminalFailureRecord) => Promise<void>;
}>;

const toTimestamp = (value: Date | number): number => {
  return value instanceof Date ? value.getTime() : value;
};

export const createPushTokenIdentity = (
  input: Readonly<{ reminderId: string; changeEventId: string; deviceId: string }>,
): string => {
  return `${input.reminderId}-${input.changeEventId}-${input.deviceId}`;
};

export const createPushRetryJobKey = (job: PushRetryJobPayload): string => {
  const tokenIdentity = createPushTokenIdentity({
    reminderId: job.reminderId,
    changeEventId: job.changeEventId,
    deviceId: job.token.deviceId,
  });

  return `${tokenIdentity}-attempt-${job.attempt}`;
};

export const toPushRetryJobPayload = (request: PushDeliveryRequest): PushRetryJobPayload => {
  return {
    userId: request.userId,
    reminderId: request.reminderId,
    changeEventId: request.changeEventId,
    isTrigger: request.isTrigger,
    attempt: request.attempt,
    token: request.token,
  };
};

export const resolvePushRetryDelayMs = (
  attempt: number,
  policy: PushRetryPolicy = DEFAULT_PUSH_RETRY_POLICY,
): number | null => {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new Error('attempt must be a non-negative integer');
  }

  if (attempt >= policy.maxRetries) {
    return null;
  }

  return policy.retryDelaysMs[attempt] ?? null;
};

export const createPushRetryRunAt = (
  now: Date | number,
  attempt: number,
  policy: PushRetryPolicy = DEFAULT_PUSH_RETRY_POLICY,
): Date | null => {
  const delayMs = resolvePushRetryDelayMs(attempt, policy);

  if (delayMs === null) {
    return null;
  }

  return new Date(toTimestamp(now) + delayMs);
};
