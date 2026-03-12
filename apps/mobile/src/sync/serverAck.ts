import { Note } from '../db/notesRepo';

const normalizeNullish = <T>(value: T | null | undefined): T | null =>
  value === undefined ? null : value;

const jsonLikeEqual = (a: unknown, b: unknown): boolean => {
  if (a == null && b == null) return true;
  return JSON.stringify(a) === JSON.stringify(b);
};

export const wasServerStateApplied = (
  payload: Note,
  serverNote: Partial<Note> | undefined,
): boolean => {
  if (!serverNote) return false;

  // If server updatedAt is older than local payload, update was not accepted.
  if (typeof serverNote.updatedAt === 'number' && serverNote.updatedAt < payload.updatedAt) {
    return false;
  }

  const primitiveFields: Array<keyof Note> = [
    'title',
    'content',
    'color',
    'active',
    'done',
    'isPinned',
    'triggerAt',
    'repeatRule',
    'snoozedUntil',
    'scheduleStatus',
    'timezone',
    'baseAtLocal',
    'startAt',
    'nextTriggerAt',
    'lastFiredAt',
    'lastAcknowledgedAt',
  ];

  for (const field of primitiveFields) {
    const localValue = normalizeNullish(payload[field]);
    const serverValue = normalizeNullish(serverNote[field]);
    if (localValue !== serverValue) {
      return false;
    }
  }

  return (
    jsonLikeEqual(payload.repeatConfig, serverNote.repeatConfig) &&
    jsonLikeEqual(payload.repeat, serverNote.repeat)
  );
};
