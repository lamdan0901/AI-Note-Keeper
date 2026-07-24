/**
 * Session-expired event channel. The mobile API client fires this when the
 * server permanently rejects a refresh token, so UI (AuthContext) can move to
 * the logged-out state instead of syncing failing silently forever.
 */

type SessionExpiredListener = () => void;

const listeners = new Set<SessionExpiredListener>();

export const onSessionExpired = (listener: SessionExpiredListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const notifySessionExpired = (): void => {
  for (const listener of listeners) {
    listener();
  }
};
