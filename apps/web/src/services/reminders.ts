import { useState, useEffect } from 'react';
import { useBackendClient } from '../../../../packages/shared/backend/context';
import type {
  Reminder,
  ReminderCreate,
  ReminderScheduleStatus,
  ReminderUpdate,
  UUID,
} from '../../../../packages/shared/types/reminder';
import { nowMs, uuidv4 } from '../../../../packages/shared/utils';

type ReminderCreateInput = Omit<
  ReminderCreate,
  | 'id'
  | 'noteId'
  | 'title'
  | 'repeatConfig'
  | 'snoozedUntil'
  | 'scheduleStatus'
  | 'timezone'
  | 'createdAt'
  | 'updatedAt'
> & {
  id?: UUID;
  noteId?: UUID | null;
  title?: string | null;
  repeatConfig?: Record<string, unknown> | null;
  snoozedUntil?: number | null;
  scheduleStatus?: ReminderScheduleStatus;
  timezone?: string;
  createdAt?: number;
  updatedAt?: number;
};

const resolveTimezone = (timezone?: string): string => {
  if (timezone) {
    return timezone;
  }
  if (typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (resolved) {
      return resolved;
    }
  }
  return 'UTC';
};

/**
 * Hook to fetch a single reminder by ID.
 * @param reminderId The UUID of the reminder to fetch.
 * @returns The reminder object, null if not found, or undefined whilst loading.
 */
export const useReminder = (reminderId: UUID): Reminder | null | undefined => {
  const client = useBackendClient();
  const [reminder, setReminder] = useState<Reminder | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    client
      .getReminder(reminderId)
      .then((result) => {
        if (!cancelled) setReminder(result);
      })
      .catch(() => {
        if (!cancelled) setReminder(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client, reminderId]);

  return reminder;
};

/**
 * Hook to create a reminder.
 * @returns A function that takes the reminder creation data.
 */
export const useCreateReminder = () => {
  const client = useBackendClient();

  return async (reminder: ReminderCreateInput) => {
    const now = nowMs();
    const createdAt = reminder.createdAt ?? now;
    const updatedAt = reminder.updatedAt ?? createdAt;

    return await client.createReminder({
      ...reminder,
      id: reminder.id ?? uuidv4(),
      noteId: reminder.noteId ?? null,
      title: reminder.title ?? null,
      repeatConfig: reminder.repeatConfig ?? null,
      snoozedUntil: reminder.snoozedUntil ?? null,
      scheduleStatus: reminder.scheduleStatus ?? 'unscheduled',
      timezone: resolveTimezone(reminder.timezone),
      createdAt,
      updatedAt,
    } as ReminderCreate);
  };
};

/**
 * Hook to update a reminder.
 * @returns A function that takes the reminder ID and the updates to apply.
 */
export const useUpdateReminder = () => {
  const client = useBackendClient();

  return async (id: UUID, changes: ReminderUpdate) => {
    return await client.updateReminder(id, changes);
  };
};

/**
 * Hook to delete a reminder.
 * @returns A function that takes the reminder ID.
 */
export const useDeleteReminder = () => {
  const client = useBackendClient();

  return async (id: UUID) => {
    return await client.deleteReminder(id);
  };
};
