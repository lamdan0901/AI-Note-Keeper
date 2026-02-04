import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type {
  Reminder,
  ReminderCreate,
  ReminderScheduleStatus,
  ReminderUpdate,
  UUID,
} from "../../../../packages/shared/types/reminder";
import { nowMs, uuidv4 } from "../../../../packages/shared/utils";

type ReminderCreateInput = Omit<
  ReminderCreate,
  | "id"
  | "noteId"
  | "title"
  | "repeatConfig"
  | "snoozedUntil"
  | "scheduleStatus"
  | "timezone"
  | "createdAt"
  | "updatedAt"
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
  if (typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function") {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (resolved) {
      return resolved;
    }
  }
  return "UTC";
};

/**
 * Hook to fetch a single reminder by ID.
 * @param reminderId The UUID of the reminder to fetch.
 * @returns The reminder object, null if not found, or undefined whilst loading.
 */
export const useReminder = (reminderId: UUID): Reminder | null | undefined => {
  return useQuery(api.functions.reminders.getReminder, { reminderId });
};

/**
 * Hook to create a reminder.
 * @returns A function that takes the reminder creation data.
 */
export const useCreateReminder = () => {
  const create = useMutation(api.functions.reminders.createReminder);

  /**
   * Creates a new reminder.
   * @param reminder The reminder data to create.
   */
  return async (reminder: ReminderCreateInput) => {
    const now = nowMs();
    const createdAt = reminder.createdAt ?? now;
    const updatedAt = reminder.updatedAt ?? createdAt;

    return await create({
      ...reminder,
      id: reminder.id ?? uuidv4(),
      noteId: reminder.noteId ?? null,
      title: reminder.title ?? null,
      repeatConfig: reminder.repeatConfig ?? null,
      snoozedUntil: reminder.snoozedUntil ?? null,
      scheduleStatus: reminder.scheduleStatus ?? "unscheduled",
      timezone: resolveTimezone(reminder.timezone),
      createdAt,
      updatedAt,
    });
  };
};

/**
 * Hook to update a reminder.
 * @returns A function that takes the reminder ID and the updates to apply.
 */
export const useUpdateReminder = () => {
  const update = useMutation(api.functions.reminders.updateReminder);

  /**
   * Updates a reminder.
   * @param id The UUID of the reminder to update.
   * @param changes The changes to apply. MUST include 'updatedAt'.
   */
  return async (id: UUID, changes: ReminderUpdate) => {
    return await update({
      id,
      ...changes,
    });
  };
};

/**
 * Hook to delete a reminder.
 * @returns A function that takes the reminder ID.
 */
export const useDeleteReminder = () => {
  const remove = useMutation(api.functions.reminders.deleteReminder);

  /**
   * Deletes a reminder.
   * @param id The UUID of the reminder to delete.
   */
  return async (id: UUID) => {
    return await remove({ id });
  };
};
