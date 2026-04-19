import {
  type PushDeliveryRequest,
  type PushDeliveryResult,
  type PushDeliveryService,
  type PushProvider,
} from './contracts.js';

const classifyProviderFailure = (statusCode?: number, errorCode?: string): PushDeliveryResult => {
  if (statusCode === 404 && errorCode === 'UNREGISTERED') {
    return {
      classification: 'unregistered',
      statusCode,
      errorCode,
    };
  }

  if (statusCode === 429 || (typeof statusCode === 'number' && statusCode >= 500)) {
    return {
      classification: 'transient_failure',
      statusCode,
      errorCode,
    };
  }

  return {
    classification: 'terminal_failure',
    statusCode,
    errorCode,
  };
};

export type PushDeliveryServiceDeps = Readonly<{
  provider: PushProvider;
}>;

export const createPushDeliveryService = (deps: PushDeliveryServiceDeps): PushDeliveryService => {
  return {
    deliverToToken: async (request: PushDeliveryRequest) => {
      try {
        const response = await deps.provider.sendToToken(request);

        if (response.ok) {
          return {
            classification: 'delivered',
          } satisfies PushDeliveryResult;
        }

        const classified = classifyProviderFailure(response.statusCode, response.errorCode);
        return {
          ...classified,
          message: response.message,
        } satisfies PushDeliveryResult;
      } catch (error) {
        return {
          classification: 'transient_failure',
          message: error instanceof Error ? error.message : String(error),
        } satisfies PushDeliveryResult;
      }
    },
  };
};
