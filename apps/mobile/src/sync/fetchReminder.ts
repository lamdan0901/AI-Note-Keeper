import type { Reminder } from '../../../../packages/shared/types/reminder';
import { logSyncEvent } from '../reminders/logging';
import { createDefaultMobileApiClient } from '../api/httpClient';

export type FetchReminderResult =
  | { status: 'ok'; reminder: Reminder }
  | { status: 'not_found'; reminder: null }
  | { status: 'error'; reminder: null; error: unknown };

export const fetchReminder = async (
  reminderId: string,
): Promise<FetchReminderResult> => {
  try {
    const apiClient = createDefaultMobileApiClient();
    const response = await apiClient.requestJson<Readonly<{ reminder: Reminder | null }>>(
      `/api/reminders/${reminderId}`,
    );
    const reminder = response.reminder;

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
