export type UUID = string;
export type TimestampMs = number;

export type RepeatRule =
  | { kind: 'daily'; interval: number }
  | { kind: 'weekly'; interval: number; weekdays: number[] } // 0=Sun
  | { kind: 'monthly'; interval: number; mode: 'day_of_month' }
  | { kind: 'custom'; interval: number; frequency: 'minutes' | 'days' | 'weeks' | 'months' };

export type ReminderRepeatRule = 'none' | 'daily' | 'weekly' | 'custom';
export type ReminderScheduleStatus = 'scheduled' | 'unscheduled' | 'error';

export interface Reminder {
  id: UUID;
  userId: UUID;
  title: string | null;
  triggerAt: TimestampMs;

  // Legacy fields (kept for compatibility during migration)
  repeatRule: ReminderRepeatRule;
  repeatConfig: Record<string, unknown> | null;

  // New standardized repeat rule
  repeat: RepeatRule | null;

  snoozedUntil: TimestampMs | null;
  active: boolean;
  scheduleStatus: ReminderScheduleStatus;
  timezone: string;

  // New fields from spec
  baseAtLocal: string | null; // ISO string "2026-02-01T09:00"
  startAt: TimestampMs | null; // Epoch ms of first intended occurrence (ANCHOR)
  nextTriggerAt: TimestampMs | null;
  lastFiredAt: TimestampMs | null;
  lastAcknowledgedAt: TimestampMs | null;
  version: number;

  updatedAt: TimestampMs;
  createdAt: TimestampMs;
}

export interface ReminderCreate {
  id: UUID;
  userId: UUID;
  title?: string | null;
  triggerAt: TimestampMs;
  repeatRule?: ReminderRepeatRule;
  repeatConfig?: Record<string, unknown> | null;
  repeat?: RepeatRule | null;
  snoozedUntil?: TimestampMs | null;
  active: boolean;
  scheduleStatus?: ReminderScheduleStatus;
  timezone: string;
  baseAtLocal?: string | null;
  startAt?: TimestampMs | null;
  updatedAt?: TimestampMs;
  createdAt?: TimestampMs;
}

export interface ReminderUpdate {
  title?: string | null;
  triggerAt?: TimestampMs;
  repeatRule?: ReminderRepeatRule;
  repeatConfig?: Record<string, unknown> | null;
  repeat?: RepeatRule | null;
  snoozedUntil?: TimestampMs | null;
  active?: boolean;
  scheduleStatus?: ReminderScheduleStatus;
  timezone?: string;
  baseAtLocal?: string | null;
  startAt?: TimestampMs | null;
  nextTriggerAt?: TimestampMs | null;
  lastFiredAt?: TimestampMs | null;
  lastAcknowledgedAt?: TimestampMs | null;
  version?: number;
  updatedAt: TimestampMs;
}

export type ReminderChangeOperation = 'create' | 'update' | 'delete';

export interface ReminderChangeEvent {
  id: UUID;
  reminderId: UUID;
  userId: UUID;
  operation: ReminderChangeOperation;
  changedAt: TimestampMs;
  deviceId: UUID;
  payloadHash: string;
}

export interface DevicePushTokenUpsert {
  userId: UUID;
  fcmToken: string;
  platform: 'android';
}
