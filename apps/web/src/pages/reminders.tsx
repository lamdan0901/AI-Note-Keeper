import React, { useEffect, useMemo, useState } from 'react';

import type { Reminder } from '../../../../packages/shared/types/reminder';
import { createWebApiClient } from '../api/httpClient';
import { useWebAuth } from '../auth/AuthContext';

type DedupedReminder = {
  reminder: Reminder;
  count: number;
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
    title: input.title ?? null,
  } as Reminder;
};

const formatTimestamp = (timestampMs: number, timezone: string): string => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(new Date(timestampMs));
  } catch {
    return new Date(timestampMs).toLocaleString();
  }
};

const dedupeReminders = (reminders: Reminder[]): DedupedReminder[] => {
  const byId = new Map<string, DedupedReminder>();

  for (const reminder of reminders) {
    const existing = byId.get(reminder.id);
    if (!existing) {
      byId.set(reminder.id, { reminder, count: 1 });
      continue;
    }

    existing.count += 1;
    if (reminder.updatedAt > existing.reminder.updatedAt) {
      existing.reminder = reminder;
    }
  }

  return Array.from(byId.values()).sort((a, b) => b.reminder.updatedAt - a.reminder.updatedAt);
};

export default function RemindersPage(): JSX.Element {
  const { getAccessToken, refreshAccessToken } = useWebAuth();
  const [reminders, setReminders] = useState<Reminder[] | null>(null);
  const [loading, setLoading] = useState(true);

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

    const load = async (): Promise<void> => {
      setLoading(true);
      try {
        const response =
          await apiClient.requestJson<Readonly<{ reminders: unknown[] }>>('/api/reminders');
        if (!cancelled) {
          setReminders((response.reminders ?? []).map(mapApiReminderToReminder));
        }
      } catch {
        if (!cancelled) {
          setReminders([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  const deduped = useMemo(() => {
    if (reminders === null) {
      return null;
    }

    const list = dedupeReminders(reminders);
    return {
      list,
      total: reminders.length,
      dedupedCount: list.length,
      duplicateCount: reminders.length - list.length,
    };
  }, [reminders]);

  if (loading) {
    return (
      <section className="panel">
        <h2>Reminders</h2>
        <p>Loading reminders...</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Reminders</h2>
      {deduped && (
        <p>
          Showing {deduped.dedupedCount} of {deduped.total} records
          {deduped.duplicateCount > 0
            ? ` (collapsed ${deduped.duplicateCount} ${
                deduped.duplicateCount === 1 ? 'duplicate' : 'duplicates'
              })`
            : ''}
          .
        </p>
      )}
      {deduped && deduped.list.length === 0 ? (
        <p>No reminders yet.</p>
      ) : (
        <div style={{ marginTop: '16px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th>Title</th>
                <th>Next Trigger</th>
                <th>Repeat</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Dedup</th>
              </tr>
            </thead>
            <tbody>
              {deduped?.list.map(({ reminder, count }) => (
                <tr key={reminder.id}>
                  <td>{reminder.title ?? 'Untitled'}</td>
                  <td>{formatTimestamp(reminder.triggerAt, reminder.timezone)}</td>
                  <td>{reminder.repeatRule}</td>
                  <td>{reminder.active ? reminder.scheduleStatus : 'inactive'}</td>
                  <td>{formatTimestamp(reminder.updatedAt, reminder.timezone)}</td>
                  <td>{count > 1 ? `x${count}` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
