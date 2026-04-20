export type CanonicalRepeatPatch = {
  repeat?: Record<string, unknown> | null;
  startAt?: Date | null;
  baseAtLocal?: string | null;
  nextTriggerAt?: Date | null;
  lastFiredAt?: Date | null;
  lastAcknowledgedAt?: Date | null;
};

export type NoteSyncChange = Readonly<{
  id: string;
  userId: string;
  operation: 'create' | 'update' | 'delete';
  payloadHash: string;
  deviceId: string;
  updatedAt: number;
  createdAt?: number;
  title?: string | null;
  content?: string | null;
  contentType?: string | null;
  color?: string | null;
  active?: boolean;
  done?: boolean | null;
  isPinned?: boolean | null;
  triggerAt?: number | null;
  repeatRule?: string | null;
  repeatConfig?: Record<string, unknown> | null;
  snoozedUntil?: number | null;
  scheduleStatus?: string | null;
  timezone?: string | null;
  deletedAt?: number | null;
  repeat?: Record<string, unknown> | null;
  startAt?: number | null;
  baseAtLocal?: string | null;
  nextTriggerAt?: number | null;
  lastFiredAt?: number | null;
  lastAcknowledgedAt?: number | null;
}>;

export type NoteSyncRequest = Readonly<{
  userId: string;
  changes: ReadonlyArray<NoteSyncChange>;
  lastSyncAt: number;
}>;

export type NoteRecord = Readonly<{
  id: string;
  userId: string;
  title: string | null;
  content: string | null;
  contentType: string | null;
  color: string | null;
  active: boolean;
  done: boolean | null;
  isPinned: boolean | null;
  triggerAt: Date | null;
  repeatRule: string | null;
  repeatConfig: Record<string, unknown> | null;
  repeat: Record<string, unknown> | null;
  snoozedUntil: Date | null;
  scheduleStatus: string | null;
  timezone: string | null;
  baseAtLocal: string | null;
  startAt: Date | null;
  nextTriggerAt: Date | null;
  lastFiredAt: Date | null;
  lastAcknowledgedAt: Date | null;
  version: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type NoteSyncResponse = Readonly<{
  notes: ReadonlyArray<NoteRecord>;
  syncedAt: number;
}>;

export type NoteCanonicalField =
  | 'repeat'
  | 'startAt'
  | 'baseAtLocal'
  | 'nextTriggerAt'
  | 'lastFiredAt'
  | 'lastAcknowledgedAt'
  | 'deletedAt';

export const hasOwnField = <K extends string>(
  value: Record<string, unknown>,
  key: K,
): value is Record<K, unknown> => {
  return Object.prototype.hasOwnProperty.call(value, key);
};

const toNullableDate = (value: number | null | undefined): Date | null | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return new Date(value);
};

export const toCanonicalPatch = (change: NoteSyncChange): CanonicalRepeatPatch => {
  const patch: CanonicalRepeatPatch = {};
  if (hasOwnField(change as Record<string, unknown>, 'repeat')) {
    patch.repeat = change.repeat ?? null;
  }
  if (hasOwnField(change as Record<string, unknown>, 'startAt')) {
    patch.startAt = toNullableDate(change.startAt);
  }
  if (hasOwnField(change as Record<string, unknown>, 'baseAtLocal')) {
    patch.baseAtLocal = change.baseAtLocal ?? null;
  }
  if (hasOwnField(change as Record<string, unknown>, 'nextTriggerAt')) {
    patch.nextTriggerAt = toNullableDate(change.nextTriggerAt);
  }
  if (hasOwnField(change as Record<string, unknown>, 'lastFiredAt')) {
    patch.lastFiredAt = toNullableDate(change.lastFiredAt);
  }
  if (hasOwnField(change as Record<string, unknown>, 'lastAcknowledgedAt')) {
    patch.lastAcknowledgedAt = toNullableDate(change.lastAcknowledgedAt);
  }

  return patch;
};
