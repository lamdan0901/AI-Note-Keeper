import type { ReminderPatchInput, ReminderRecord } from './contracts.js';
import type { RemindersRepository } from './repositories/reminders-repository.js';
import { REMINDER_DISABLED_PROVIDER, type SchedulerProvider } from './scheduler-provider.js';

/**
 * Delivery identity is (reminder, occurrence) — deliberately NOT the note version.
 * `version` bumps on every note write, including title/content edits that leave the
 * fire time alone; keying on it made those edits invalidate a perfectly good
 * schedule. Duplicate suppression comes from the
 * `reminder_deliveries UNIQUE (reminder_id, occurrence_at)` constraint instead.
 *
 * `version` is still accepted (and ignored) so existing call sites read naturally.
 */
export const createReminderDeliveryKey = (
  input: Readonly<{ reminderId: string; occurrenceAt: Date | number; version?: number }>,
): string => {
  const occurrenceMs =
    input.occurrenceAt instanceof Date ? input.occurrenceAt.getTime() : input.occurrenceAt;
  return `${input.reminderId}:${occurrenceMs}`;
};

export type ReminderSchedulerService = Readonly<{
  scheduleNextOccurrence: (
    reminder: ReminderRecord,
  ) => Promise<Readonly<{ scheduled: boolean; deliveryKey?: string; reason?: string }>>;
  cancelCurrentSchedule: (reminder: ReminderRecord) => Promise<void>;
  clearScheduleMetadata: (reminder: ReminderRecord) => Promise<void>;
}>;

export const createReminderSchedulerService = (
  deps: Readonly<{
    provider: SchedulerProvider;
    remindersRepository: Pick<RemindersRepository, 'patch'>;
    now?: () => Date;
  }>,
): ReminderSchedulerService => {
  const now = deps.now ?? (() => new Date());

  const clearPatch = (): ReminderPatchInput => ({
    scheduleProvider: null,
    scheduleTargetId: null,
    scheduleTargetVersion: null,
    scheduleTargetFireAt: null,
    updatedAt: now(),
  });

  return {
    scheduleNextOccurrence: async (reminder) => {
      if (!reminder.active || reminder.nextTriggerAt === null) {
        return { scheduled: false, reason: 'not_due' };
      }

      // The disabled provider throws by design (local dev / scheduler-off deploys).
      // That is not a delivery failure, so it must not mark the reminder errored.
      if (deps.provider.name === REMINDER_DISABLED_PROVIDER) {
        return { scheduled: false, reason: 'provider_disabled' };
      }

      const deliveryKey = createReminderDeliveryKey({
        reminderId: reminder.id,
        occurrenceAt: reminder.nextTriggerAt,
        version: reminder.version,
      });

      try {
        const scheduled = await deps.provider.scheduleOnce({
          reminderId: reminder.id,
          occurrenceAt: reminder.nextTriggerAt,
          version: reminder.version,
          deliveryKey,
        });

        await deps.remindersRepository.patch({
          reminderId: reminder.id,
          userId: reminder.userId,
          patch: {
            scheduleStatus: 'scheduled',
            scheduleProvider: scheduled.provider,
            scheduleTargetId: scheduled.scheduleId,
            scheduleTargetVersion: reminder.version,
            scheduleTargetFireAt: scheduled.fireAt,
            updatedAt: now(),
          },
        });

        return { scheduled: true, deliveryKey };
      } catch (error) {
        // A swallowed publish failure used to leave the row claiming a schedule it
        // no longer had, so nothing — not the repair job, not the next save — knew
        // to republish it. Record the failure so it is visible and recoverable.
        await deps.remindersRepository
          .patch({
            reminderId: reminder.id,
            userId: reminder.userId,
            patch: { ...clearPatch(), scheduleStatus: 'error' },
          })
          .catch((patchError: unknown) => {
            console.error('[reminders:scheduler] failed to record schedule error', {
              reminderId: reminder.id,
              error: patchError instanceof Error ? patchError.message : String(patchError),
            });
          });

        console.error('[reminders:scheduler] provider publish failed; reminder is unscheduled', {
          reminderId: reminder.id,
          provider: deps.provider.name,
          nextTriggerAt: reminder.nextTriggerAt.toISOString(),
          error: error instanceof Error ? error.message : String(error),
        });

        return { scheduled: false, deliveryKey, reason: 'provider_failed' };
      }
    },
    cancelCurrentSchedule: async (reminder) => {
      if (reminder.scheduleTargetId) {
        await deps.provider.cancel({ scheduleId: reminder.scheduleTargetId }).catch(() => undefined);
      }

      await deps.remindersRepository.patch({
        reminderId: reminder.id,
        userId: reminder.userId,
        patch: clearPatch(),
      });
    },
    clearScheduleMetadata: async (reminder) => {
      await deps.remindersRepository.patch({
        reminderId: reminder.id,
        userId: reminder.userId,
        patch: clearPatch(),
      });
    },
  };
};
