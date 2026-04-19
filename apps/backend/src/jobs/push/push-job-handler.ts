import type { DeviceTokensRepository } from '../../device-tokens/repositories/device-tokens-repository.js';
import {
  createPushRetryJobKey,
  createPushTokenIdentity,
  resolvePushRetryDelayMs,
  toPushRetryJobPayload,
  type PushDeliveryRequest,
  type PushDeliveryService,
  type PushJobPayload,
  type PushRetryPolicy,
  type PushRetryScheduler,
  type PushTerminalFailureRecorder,
} from './contracts.js';

export type PushJobHandlerDeps = Readonly<{
  deliveryService: PushDeliveryService;
  deviceTokensRepository: Pick<DeviceTokensRepository, 'deleteByDeviceIdForUser'>;
  retryScheduler: PushRetryScheduler;
  terminalFailureRecorder: PushTerminalFailureRecorder;
  retryPolicy?: PushRetryPolicy;
}>;

export type PushJobRunResult = Readonly<{
  processed: number;
  delivered: number;
  retriesScheduled: number;
  unregisteredRemoved: number;
  terminalFailures: number;
}>;

export type PushJobHandler = Readonly<{
  handle: (job: PushJobPayload) => Promise<PushJobRunResult>;
}>;

const toFailureReason = (
  input: Readonly<{ statusCode?: number; errorCode?: string; message?: string }>,
): string => {
  if (input.errorCode) {
    return input.errorCode;
  }

  if (input.statusCode !== undefined) {
    return `status_${input.statusCode}`;
  }

  if (input.message) {
    return input.message;
  }

  return 'unknown_error';
};

const normalizeAttempt = (attempt: number): number => {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new Error('push attempt must be a non-negative integer');
  }

  return attempt;
};

export const createPushJobHandler = (deps: PushJobHandlerDeps): PushJobHandler => {
  const retryPolicy = deps.retryPolicy;

  return {
    handle: async (job) => {
      const baseAttempt = normalizeAttempt(job.attempt);
      let delivered = 0;
      let retriesScheduled = 0;
      let unregisteredRemoved = 0;
      let terminalFailures = 0;

      for (const token of job.tokens) {
        const request: PushDeliveryRequest = {
          userId: job.userId,
          reminderId: job.reminderId,
          changeEventId: job.changeEventId,
          isTrigger: job.isTrigger,
          attempt: baseAttempt,
          token,
        };

        try {
          const result = await deps.deliveryService.deliverToToken(request);

          if (result.classification === 'delivered') {
            delivered += 1;
            continue;
          }

          if (result.classification === 'unregistered') {
            const removed = await deps.deviceTokensRepository.deleteByDeviceIdForUser({
              userId: job.userId,
              deviceId: token.deviceId,
            });

            if (removed) {
              unregisteredRemoved += 1;
            }

            continue;
          }

          if (result.classification === 'transient_failure') {
            const delayMs = resolvePushRetryDelayMs(baseAttempt, retryPolicy);

            if (delayMs !== null) {
              const retryPayload = {
                ...toPushRetryJobPayload(request),
                attempt: baseAttempt + 1,
              };

              await deps.retryScheduler.scheduleRetry({
                delayMs,
                job: retryPayload,
                jobKey: createPushRetryJobKey(retryPayload),
              });

              retriesScheduled += 1;
              continue;
            }
          }

          terminalFailures += 1;
          await deps.terminalFailureRecorder.record({
            tokenIdentity: createPushTokenIdentity({
              reminderId: job.reminderId,
              changeEventId: job.changeEventId,
              deviceId: token.deviceId,
            }),
            userId: job.userId,
            reminderId: job.reminderId,
            changeEventId: job.changeEventId,
            attempt: baseAttempt,
            statusCode: result.statusCode,
            errorCode: result.errorCode,
            reason: toFailureReason(result),
          });
        } catch (error) {
          terminalFailures += 1;
          await deps.terminalFailureRecorder.record({
            tokenIdentity: createPushTokenIdentity({
              reminderId: job.reminderId,
              changeEventId: job.changeEventId,
              deviceId: token.deviceId,
            }),
            userId: job.userId,
            reminderId: job.reminderId,
            changeEventId: job.changeEventId,
            attempt: baseAttempt,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return {
        processed: job.tokens.length,
        delivered,
        retriesScheduled,
        unregisteredRemoved,
        terminalFailures,
      };
    },
  };
};
