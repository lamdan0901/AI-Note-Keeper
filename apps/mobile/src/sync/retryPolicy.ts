export type RetryPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
};

export const defaultRetryPolicy: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  jitterRatio: 0.2,
};

export const shouldRetry = (attempt: number, policy = defaultRetryPolicy): boolean =>
  attempt < policy.maxAttempts;

export const getRetryDelayMs = (
  attempt: number,
  policy = defaultRetryPolicy,
): number => {
  const safeAttempt = Math.max(0, attempt);
  const exponential = policy.baseDelayMs * Math.pow(2, safeAttempt);
  const capped = Math.min(exponential, policy.maxDelayMs);
  if (policy.jitterRatio <= 0) {
    return Math.floor(capped);
  }
  const jitterRange = capped * policy.jitterRatio;
  const jitter = (Math.random() * 2 - 1) * jitterRange;
  return Math.max(0, Math.floor(capped + jitter));
};
