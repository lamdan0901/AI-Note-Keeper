import { useBackendHooks } from '../../../../packages/shared/backend/context';

export function useRealtimeNotes(userId: string, enabled = true) {
  return useBackendHooks().useNotes(userId, enabled);
}
