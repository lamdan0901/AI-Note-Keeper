import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  Reminder,
  ReminderCreate,
  ReminderScheduleStatus,
  ReminderUpdate,
  UUID,
} from '../../../../packages/shared/types/reminder';
import { nowMs, uuidv4 } from '../../../../packages/shared/utils';
import { useWebAuth } from '../auth/AuthContext';
import { createWebApiClient } from '../api/httpClient';

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

const toEpochMs = (value: unknown): number | null | undefined => {
  if (value === null || value === undefined) {
    return value as null | undefined;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  return undefined;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mapApiReminderToReminder = (input: any): Reminder => {
  return {
    ...input,
    triggerAt: toEpochMs(input.triggerAt) ?? Date.now(),
    snoozedUntil: toEpochMs(input.snoozedUntil) ?? null,
    createdAt: toEpochMs(input.createdAt) ?? Date.now(),
    updatedAt: toEpochMs(input.updatedAt) ?? Date.now(),
    nextTriggerAt: toEpochMs(input.nextTriggerAt) ?? null,
    lastFiredAt: toEpochMs(input.lastFiredAt) ?? null,
    lastAcknowledgedAt: toEpochMs(input.lastAcknowledgedAt) ?? null,
  } as Reminder;
};

export const useReminder = (reminderId: UUID): Reminder | null | undefined => {
  const { getAccessToken, refreshAccessToken } = useWebAuth();
  const [reminder, setReminder] = useState<Reminder | null | undefined>(undefined);

  const apiClient = useMemo(
    () =>
      createWebApiClient({
        getAccessToken,
        refreshAccessToken,
      }),
    [getAccessToken, refreshAccessToken],
  );

  useEffect(() => {
    let cancelled = false;
    setReminder(undefined);

    const load = async () => {
      try {
        const response = await apiClient.requestJson<Readonly<{ reminder: unknown | null }>>(
          `/api/reminders/${reminderId}`,
        );

        if (!cancelled) {
          setReminder(
            response.reminder === null ? null : mapApiReminderToReminder(response.reminder),
          );
        }
      } catch {
        if (!cancelled) {
          setReminder(null);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [apiClient, reminderId]);

  return reminder;
};

export const useCreateReminder = () => {
  const { getAccessToken, refreshAccessToken } = useWebAuth();
  const apiClient = useMemo(
    () =>
      createWebApiClient({
        getAccessToken,
        refreshAccessToken,
      }),
    [getAccessToken, refreshAccessToken],
  );

  return useCallback(
    async (reminder: ReminderCreateInput): Promise<Reminder> => {
      const now = nowMs();
      const createdAt = reminder.createdAt ?? now;
      const updatedAt = reminder.updatedAt ?? createdAt;

      const response = await apiClient.requestJson<Readonly<{ reminder: unknown }>>(
        '/api/reminders',
        {
          method: 'POST',
          body: {
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
          },
        },
      );

      return mapApiReminderToReminder(response.reminder);
    },
    [apiClient],
  );
};

export const useUpdateReminder = () => {
  const { getAccessToken, refreshAccessToken } = useWebAuth();
  const apiClient = useMemo(
    () =>
      createWebApiClient({
        getAccessToken,
        refreshAccessToken,
      }),
    [getAccessToken, refreshAccessToken],
  );

  return useCallback(
    async (id: UUID, changes: ReminderUpdate): Promise<Readonly<{ reminder: Reminder | null }>> => {
      const response = await apiClient.requestJson<Readonly<{ reminder: unknown | null }>>(
        `/api/reminders/${id}`,
        {
          method: 'PATCH',
          body: changes,
        },
      );

      return {
        reminder: response.reminder === null ? null : mapApiReminderToReminder(response.reminder),
      };
    },
    [apiClient],
  );
};

export const useDeleteReminder = () => {
  const { getAccessToken, refreshAccessToken } = useWebAuth();
  const apiClient = useMemo(
    () =>
      createWebApiClient({
        getAccessToken,
        refreshAccessToken,
      }),
    [getAccessToken, refreshAccessToken],
  );

  return useCallback(
    async (id: UUID): Promise<Readonly<{ deleted: boolean }>> => {
      return await apiClient.requestJson<Readonly<{ deleted: boolean }>>(`/api/reminders/${id}`, {
        method: 'DELETE',
      });
    },
    [apiClient],
  );
};
