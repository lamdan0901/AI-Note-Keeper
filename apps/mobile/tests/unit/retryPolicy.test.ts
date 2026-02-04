import { describe, expect, it, jest } from "@jest/globals";

import {
  defaultRetryPolicy,
  getRetryDelayMs,
  shouldRetry,
} from "../../src/sync/retryPolicy";

describe("retryPolicy", () => {
  describe("shouldRetry", () => {
    it("returns true while attempts remain", () => {
      expect(shouldRetry(0)).toBe(true);
      expect(shouldRetry(defaultRetryPolicy.maxAttempts - 1)).toBe(true);
    });

    it("returns false once max attempts is reached", () => {
      expect(shouldRetry(defaultRetryPolicy.maxAttempts)).toBe(false);
      expect(shouldRetry(defaultRetryPolicy.maxAttempts + 2)).toBe(false);
    });
  });

  describe("getRetryDelayMs", () => {
    it("treats negative attempts as 0", () => {
      const policy = { ...defaultRetryPolicy, jitterRatio: 0 };
      const zeroAttempt = getRetryDelayMs(0, policy);
      const negativeAttempt = getRetryDelayMs(-3, policy);
      expect(negativeAttempt).toBe(zeroAttempt);
    });

    it("returns exponential backoff capped at maxDelayMs", () => {
      const policy = {
        maxAttempts: 10,
        baseDelayMs: 1000,
        maxDelayMs: 5000,
        jitterRatio: 0,
      };
      expect(getRetryDelayMs(0, policy)).toBe(1000);
      expect(getRetryDelayMs(2, policy)).toBe(4000);
      expect(getRetryDelayMs(5, policy)).toBe(5000);
    });

    it("does not apply jitter when jitterRatio is 0", () => {
      const policy = { ...defaultRetryPolicy, jitterRatio: 0 };
      const randomSpy = jest.spyOn(Math, "random").mockReturnValue(0.5);
      const delay = getRetryDelayMs(1, policy);
      expect(delay).toBe(policy.baseDelayMs * 2);
      expect(randomSpy).not.toHaveBeenCalled();
      randomSpy.mockRestore();
    });

    it("applies jitter within the configured range", () => {
      const policy = {
        maxAttempts: 10,
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        jitterRatio: 0.5,
      };
      const capped = policy.baseDelayMs * Math.pow(2, 2);
      const jitterRange = capped * policy.jitterRatio;

      const maxJitterSpy = jest.spyOn(Math, "random").mockReturnValue(1);
      const maxDelay = getRetryDelayMs(2, policy);
      expect(maxDelay).toBe(Math.floor(capped + jitterRange));
      maxJitterSpy.mockRestore();

      const minJitterSpy = jest.spyOn(Math, "random").mockReturnValue(0);
      const minDelay = getRetryDelayMs(2, policy);
      expect(minDelay).toBe(Math.max(0, Math.floor(capped - jitterRange)));
      minJitterSpy.mockRestore();
    });
  });
});
