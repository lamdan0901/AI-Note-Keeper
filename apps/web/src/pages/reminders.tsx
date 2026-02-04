import React, { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Reminder } from "../../../../packages/shared/types/reminder";

type DedupedReminder = {
  reminder: Reminder;
  count: number;
};

const formatTimestamp = (timestampMs: number, timezone: string): string => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
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

  return Array.from(byId.values()).sort(
    (a, b) => b.reminder.updatedAt - a.reminder.updatedAt,
  );
};

export default function RemindersPage(): JSX.Element {
  const reminders = useQuery(api.functions.reminders.listReminders, {});

  const deduped = useMemo(() => {
    if (!reminders) {
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

  if (reminders === undefined) {
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
                deduped.duplicateCount === 1 ? "duplicate" : "duplicates"
              })`
            : ""}
          .
        </p>
      )}
      {deduped && deduped.list.length === 0 ? (
        <p>No reminders yet.</p>
      ) : (
        <div style={{ marginTop: "16px", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
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
                  <td>{reminder.title ?? "Untitled"}</td>
                  <td>{formatTimestamp(reminder.triggerAt, reminder.timezone)}</td>
                  <td>{reminder.repeatRule}</td>
                  <td>
                    {reminder.active ? reminder.scheduleStatus : "inactive"}
                  </td>
                  <td>{formatTimestamp(reminder.updatedAt, reminder.timezone)}</td>
                  <td>{count > 1 ? `x${count}` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
