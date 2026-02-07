import { RepeatRule } from './reminder';

export type Note = {
  id: string;
  userId?: string;
  title: string | null;
  content: string | null;
  color: string | null;
  active: boolean;
  done?: boolean;

  // Reminder fields
  triggerAt?: number;

  // Legacy fields (kept for compatibility)
  repeatRule?: 'none' | 'daily' | 'weekly' | 'custom';
  repeatConfig?: Record<string, unknown>;

  // New standardized repeat rule
  repeat?: RepeatRule | null;

  snoozedUntil?: number;
  scheduleStatus?: 'scheduled' | 'unscheduled' | 'error';
  timezone?: string;

  // New fields from spec
  baseAtLocal?: string | null; // ISO string "2026-02-01T09:00"
  startAt?: number | null; // Epoch ms of first intended occurrence (ANCHOR)
  nextTriggerAt?: number | null;
  lastFiredAt?: number | null;
  lastAcknowledgedAt?: number | null;
  version?: number;

  // Sync tracking fields
  syncStatus?: 'synced' | 'pending' | 'conflict';
  serverVersion?: number;

  updatedAt: number;
  createdAt: number;
};
