import type { BackendClient } from '../../../../packages/shared/backend/types';
import { createConvexBackendClient } from '../../../../packages/shared/backend/convex';
import type { Reminder } from '../../../../packages/shared/types/reminder';
import { logSyncEvent } from '../reminders/logging';

export type FetchReminderResult =
  | { status: 'ok'; reminder: Reminder }
  | { status: 'not_found'; reminder: null }
  | { status: 'error'; reminder: null; error: unknown };

type FetchReminderOptions = {
  client?: BackendClient;
  convexUrl?: string;
};

const resolveConvexUrl = (override?: string): string | null => {
  if (override) {
    return override;
  }
  if (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_CONVEX_URL) {
    return process.env.EXPO_PUBLIC_CONVEX_URL;
  }
  return null;
};

const createClient = (convexUrl?: string): BackendClient => {
  const resolved = resolveConvexUrl(convexUrl);
  if (!resolved) {
    throw new Error('Missing Convex URL for reminder fetch.');
  }
  const client = createConvexBackendClient(resolved);
  if (!client) {
    throw new Error('Failed to create backend client for reminder fetch.');
  }
  return client;
};

export const fetchReminder = async (
  reminderId: string,
  options: FetchReminderOptions = {},
): Promise<FetchReminderResult> => {
  try {
    const client = options.client ?? createClient(options.convexUrl);
    const reminder = await client.getReminder(reminderId);

    if (!reminder) {
      logSyncEvent('info', 'reminder_fetch_not_found', { reminderId });
      return { status: 'not_found', reminder: null };
    }

    logSyncEvent('info', 'reminder_fetch_success', { reminderId });
    return { status: 'ok', reminder: reminder as unknown as Reminder };
  } catch (error) {
    logSyncEvent('error', 'reminder_fetch_failed', {
      reminderId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: 'error', reminder: null, error };
  }
};
