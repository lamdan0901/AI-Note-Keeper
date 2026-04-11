import { createContext, useContext } from 'react';
import type { BackendClient, BackendHooks } from './types';

export type BackendContextValue = {
  client: BackendClient;
  hooks: BackendHooks;
};

export const BackendContext = createContext<BackendContextValue | undefined>(undefined);

export const useBackendClient = (): BackendClient => {
  const value = useContext(BackendContext);
  if (!value) {
    throw new Error(
      'useBackendClient must be called inside a BackendContext.Provider. ' +
        'Wrap your app root with BackendContext.Provider passing { client, hooks }.',
    );
  }
  return value.client;
};

export const useBackendHooks = (): BackendHooks => {
  const value = useContext(BackendContext);
  if (!value) {
    throw new Error(
      'useBackendHooks must be called inside a BackendContext.Provider. ' +
        'Wrap your app root with BackendContext.Provider passing { client, hooks }.',
    );
  }
  return value.hooks;
};
