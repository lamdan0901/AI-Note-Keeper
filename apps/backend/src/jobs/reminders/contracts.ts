export const MAX_LOOKBACK_MS = 5 * 60 * 1000;
export const REMINDER_DISPATCH_CRON_KEY = 'check-reminders';

export type ReminderDueCandidate = Readonly<{
  noteId: string;
  userId: string;
  triggerAt: Date | null;
  nextTriggerAt: Date | null;
  snoozedUntil: Date | null;
  title?: string | null;
  content?: string | null;
  contentType?: string | null;
}>;

export type ReminderDueOccurrence = Readonly<{
  noteId: string;
  userId: string;
  triggerTime: Date;
  // Rendered notification text. Optional for backwards compatibility with
  // existing scanner mocks; production scanner populates both.
  title?: string;
  body?: string;
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
  // Rendered notification text carried so the push provider can populate
  // FCM `data.title` / `data.body` with the real note contents instead of
  // a placeholder. Optional so callers that don't know the note (legacy
  // tests, retry paths that only have identifiers) can omit.
  title?: string;
  body?: string;
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
