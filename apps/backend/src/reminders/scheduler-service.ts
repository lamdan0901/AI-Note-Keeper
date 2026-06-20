import type { ReminderPatchInput, ReminderRecord } from './contracts.js';
import type { RemindersRepository } from './repositories/reminders-repository.js';
import type { SchedulerProvider } from './scheduler-provider.js';

export const createReminderDeliveryKey = (
  input: Readonly<{ reminderId: string; occurrenceAt: Date | number; version: number }>,
): string => {
  const occurrenceMs =
    input.occurrenceAt instanceof Date ? input.occurrenceAt.getTime() : input.occurrenceAt;
  return `${input.reminderId}:${occurrenceMs}:v${input.version}`;
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
      } catch {
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
