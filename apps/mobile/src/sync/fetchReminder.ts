import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../convex/_generated/api';
import type { Reminder } from '../../../../packages/shared/types/reminder';
import { logSyncEvent } from '../reminders/logging';

export type FetchReminderResult =
  | { status: 'ok'; reminder: Reminder }
  | { status: 'not_found'; reminder: null }
  | { status: 'error'; reminder: null; error: unknown };

type FetchReminderOptions = {
  client?: ConvexHttpClient;
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

const createClient = (convexUrl?: string): ConvexHttpClient => {
  const resolved = resolveConvexUrl(convexUrl);
  if (!resolved) {
    throw new Error('Missing Convex URL for reminder fetch.');
  }
  return new ConvexHttpClient(resolved);
};

export const fetchReminder = async (
  reminderId: string,
  options: FetchReminderOptions = {},
): Promise<FetchReminderResult> => {
  try {
    const client = options.client ?? createClient(options.convexUrl);
    const reminder = await client.query(api.functions.reminders.getReminder, {
      reminderId,
    });

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
