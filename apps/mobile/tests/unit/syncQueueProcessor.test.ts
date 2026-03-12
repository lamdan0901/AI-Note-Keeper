import { describe, expect, it } from '@jest/globals';
import { wasServerStateApplied } from '../../src/sync/serverAck';
import type { Note } from '../../src/db/notesRepo';

const makeNote = (overrides: Partial<Note> = {}): Note => ({
  id: 'n1',
  title: 'title',
  content: 'content',
  color: null,
  active: true,
  done: false,
  isPinned: false,
  triggerAt: 1000,
  repeatRule: 'none',
  repeatConfig: null,
  repeat: null,
  snoozedUntil: undefined,
  scheduleStatus: undefined,
  timezone: 'UTC',
  baseAtLocal: null,
  startAt: null,
  nextTriggerAt: null,
  lastFiredAt: null,
  lastAcknowledgedAt: null,
  version: 0,
  syncStatus: 'pending',
  serverVersion: 0,
  updatedAt: 2000,
  createdAt: 1000,
  ...overrides,
});

describe('wasServerStateApplied', () => {
  it('returns true when server matches payload', () => {
    const payload = makeNote();
    const server = { ...payload, version: 3 };

    expect(wasServerStateApplied(payload, server)).toBe(true);
  });

  it('returns false when server content is stale/old', () => {
    const payload = makeNote({ content: 'new content', updatedAt: 5000 });
    const server = makeNote({ content: 'old content', updatedAt: 3000 });

    expect(wasServerStateApplied(payload, server)).toBe(false);
  });

  it('returns false when server updatedAt is older than payload even if fields look same', () => {
    const payload = makeNote({ updatedAt: 7000 });
    const server = makeNote({ updatedAt: 6000 });

    expect(wasServerStateApplied(payload, server)).toBe(false);
  });
});
