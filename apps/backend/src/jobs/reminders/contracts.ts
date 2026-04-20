export const MAX_LOOKBACK_MS = 5 * 60 * 1000;
export const REMINDER_DISPATCH_CRON_KEY = 'check-reminders';

export type ReminderDueCandidate = Readonly<{
  noteId: string;
  userId: string;
  triggerAt: Date | null;
  nextTriggerAt: Date | null;
  snoozedUntil: Date | null;
}>;

export type ReminderDueOccurrence = Readonly<{
  noteId: string;
  userId: string;
  triggerTime: Date;
}>;

export type ReminderScanInput = Readonly<{
  now: Date;
  lastCheckedAt: Date | null;
}>;

export type ReminderScanResult = Readonly<{
  since: Date;
  now: Date;
  reminders: ReadonlyArray<ReminderDueOccurrence>;
}>;

export type DueReminderScanner = Readonly<{
  scanDueReminders: (input: ReminderScanInput) => Promise<ReminderScanResult>;
}>;

export type CronStateRepository = Readonly<{
  getLastCheckedAt: (key: string) => Promise<Date | null>;
  upsertLastCheckedAt: (input: Readonly<{ key: string; lastCheckedAt: Date }>) => Promise<void>;
}>;

export type ReminderDispatchQueueJob = Readonly<{
  noteId: string;
  userId: string;
  triggerTime: Date;
  eventId: string;
  jobKey: string;
}>;

export type ReminderQueueEnqueueResult = Readonly<{
  status: 'enqueued' | 'duplicate';
}>;

export type ReminderDispatchQueue = Readonly<{
  enqueue: (job: ReminderDispatchQueueJob) => Promise<ReminderQueueEnqueueResult>;
}>;

const toTimestamp = (value: Date | number): number => {
  return value instanceof Date ? value.getTime() : value;
};

export const createReminderEventId = (noteId: string, triggerTime: Date | number): string => {
  return `${noteId}-${toTimestamp(triggerTime)}`;
};

export const resolveReminderTriggerTime = (candidate: ReminderDueCandidate): Date | null => {
  if (candidate.snoozedUntil) {
    return candidate.snoozedUntil;
  }

  if (candidate.nextTriggerAt) {
    return candidate.nextTriggerAt;
  }

  return candidate.triggerAt;
};
