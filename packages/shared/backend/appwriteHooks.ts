/**
 * appwriteHooks.ts — Appwrite Realtime implementation of BackendHooks.
 *
 * Architecture
 * ────────────
 * createAppwriteBackendHooks(client) returns a BackendHooks object that
 * is created ONCE at app startup and passed into BackendContext.Provider.
 *
 * Inside the factory two UserDataStore instances are created (one per
 * collection).  A UserDataStore:
 *  • Keeps exactly ONE Realtime WebSocket subscription per collection —
 *    never more, regardless of how many React components are mounted
 *    (fixes Issue 2: reconnect churn).
 *  • Subscribes FIRST, buffers events, then fetches the initial snapshot
 *    and replays buffered events on top of it, guaranteeing no update is
 *    missed during startup (fixes Issue 1: race condition).
 *  • Notifies all registered React listeners on state changes so each hook
 *    consumer stays in sync without its own subscription.
 */
import { useEffect, useState } from 'react';
import { Client, Databases, Query } from 'appwrite';
import type { BackendHooks } from './types';
import type { Note } from '../types/note';
import type { Subscription } from '../types/subscription';
import {
  DATABASE_ID,
  NOTES_CHANNEL,
  NOTES_COLLECTION,
  SUBSCRIPTIONS_CHANNEL,
  SUBSCRIPTIONS_COLLECTION,
} from '../appwrite/collections';
import { coerceRepeatRule } from '../utils/repeatCodec';

// ---------------------------------------------------------------------------
// Doc mappers — mirror the server-side mappers in appwrite.ts and
// subscriptions-api/src/main.ts so Realtime payloads are normalised
// consistently with the initial-fetch results.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRawDocToNote(doc: Record<string, any>): Note {
  const repeat = coerceRepeatRule({
    repeat: doc.repeat ? (JSON.parse(doc.repeat as string) as object) : undefined,
    repeatRule: doc.repeatRule,
    repeatConfig: doc.repeatConfig ? (JSON.parse(doc.repeatConfig as string) as object) : undefined,
    triggerAt: doc.triggerAt,
  });

  return {
    id: (doc.$id ?? doc.id) as string,
    userId: (doc.userId as string | undefined) ?? undefined,
    title: doc.title ?? null,
    content: doc.content ?? null,
    contentType: doc.contentType ?? undefined,
    color: doc.color ?? null,
    active: Boolean(doc.active),
    done: Boolean(doc.done),
    isPinned: Boolean(doc.isPinned),
    triggerAt: doc.triggerAt ?? undefined,
    repeatRule: doc.repeatRule ?? undefined,
    repeatConfig: doc.repeatConfig
      ? (JSON.parse(doc.repeatConfig as string) as Record<string, unknown>)
      : undefined,
    repeat,
    snoozedUntil: doc.snoozedUntil ?? undefined,
    scheduleStatus: doc.scheduleStatus ?? undefined,
    timezone: doc.timezone ?? undefined,
    baseAtLocal: doc.baseAtLocal ?? null,
    startAt: doc.startAt ?? null,
    nextTriggerAt: doc.nextTriggerAt ?? null,
    lastFiredAt: doc.lastFiredAt ?? null,
    lastAcknowledgedAt: doc.lastAcknowledgedAt ?? null,
    version: doc.version ?? 0,
    deletedAt: doc.deletedAt ?? undefined,
    syncStatus: 'synced',
    serverVersion: (doc.version ?? 0) as number,
    updatedAt: doc.updatedAt as number,
    createdAt: doc.createdAt as number,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRawDocToSubscription(doc: Record<string, any>): Subscription {
  // reminderDaysBefore is stored as a JSON string in Appwrite (no integer-array attribute type).
  const raw = doc.reminderDaysBefore as string | number[] | null | undefined;
  let reminderDaysBefore: number[];
  if (typeof raw === 'string') {
    try {
      reminderDaysBefore = JSON.parse(raw) as number[];
    } catch {
      reminderDaysBefore = [];
    }
  } else if (Array.isArray(raw)) {
    reminderDaysBefore = raw as number[];
  } else {
    reminderDaysBefore = [];
  }

  return {
    id: doc.$id as string,
    userId: doc.userId as string,
    serviceName: doc.serviceName as string,
    category: (doc.category ?? '') as string,
    price: doc.price as number,
    currency: doc.currency as string,
    billingCycle: doc.billingCycle as Subscription['billingCycle'],
    billingCycleCustomDays: (doc.billingCycleCustomDays ?? undefined) as number | undefined,
    nextBillingDate: doc.nextBillingDate as number,
    trialEndDate: (doc.trialEndDate ?? undefined) as number | undefined,
    status: doc.status as Subscription['status'],
    reminderDaysBefore,
    nextReminderAt: (doc.nextReminderAt ?? undefined) as number | undefined,
    lastNotifiedBillingDate: (doc.lastNotifiedBillingDate ?? undefined) as number | undefined,
    nextTrialReminderAt: (doc.nextTrialReminderAt ?? undefined) as number | undefined,
    lastNotifiedTrialEndDate: (doc.lastNotifiedTrialEndDate ?? undefined) as number | undefined,
    notes: (doc.notes ?? undefined) as string | undefined,
    active: Boolean(doc.active),
    deletedAt: (doc.deletedAt ?? undefined) as number | undefined,
    createdAt: doc.createdAt as number,
    updatedAt: doc.updatedAt as number,
  };
}

// ---------------------------------------------------------------------------
// UserDataStore<T>
//
// Manages ONE Realtime subscription per collection for a given userId.
// Multiple React consumers share the same store instance (created once in
// the factory closure) so they never create duplicate subscriptions.
//
// Startup sequence to avoid the fetch-overwrites-event race:
//   1. client.subscribe(channel, handler)  — channel open, events buffered
//   2. databases.listDocuments()            — initial snapshot fetch
//   3. Replay buffered events on snapshot   — consistent merged state
//   4. fetchSettled = true                  — future events applied directly
//
// On userId change (login / logout): old subscription torn down, cycle repeats.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DocPayload = Record<string, any>;

class UserDataStore<T extends { id: string }> {
  private activeUserId: string | null = null;
  private data: T[] | undefined = undefined;
  private readonly listeners = new Set<() => void>();
  private unsubscribeChannel: (() => void) | null = null;

  constructor(
    private readonly client: Client,
    private readonly databases: Databases,
    private readonly channel: string,
    private readonly collectionId: string,
    private readonly mapper: (doc: DocPayload) => T,
  ) {}

  getData(): T[] | undefined {
    return this.data;
  }

  /**
   * Register a change listener and activate the subscription for userId.
   * If the store is already active for this userId, the subscription is
   * reused — no new WebSocket channel is opened.
   * Returns a cleanup function that removes the listener (does NOT tear down
   * the Realtime subscription, which is intentionally app-scoped).
   */
  activate(userId: string, listener: () => void): () => void {
    this.listeners.add(listener);
    if (this.activeUserId !== userId) {
      this.switchUser(userId);
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  /**
   * Apply a single realtime event to an array immutably.
   * For `.create` events, deduplicates by id (guards against the case where
   * a create event was buffered AND the initial fetch also returned that doc).
   */
  private applyEventToArray(items: T[], events: string[], doc: DocPayload): T[] {
    const id = doc.$id as string;
    const mapped = this.mapper(doc);
    if (events.some((e) => e.endsWith('.create'))) {
      return items.some((item) => item.id === id) ? items : [...items, mapped];
    }
    if (events.some((e) => e.endsWith('.update'))) {
      return items.map((item) => (item.id === id ? mapped : item));
    }
    if (events.some((e) => e.endsWith('.delete'))) {
      return items.filter((item) => item.id !== id);
    }
    return items;
  }

  private switchUser(userId: string): void {
    // Tear down any existing channel subscription for the previous user.
    this.unsubscribeChannel?.();
    this.unsubscribeChannel = null;
    this.activeUserId = userId;
    this.data = undefined;
    this.notify();

    // Per-switch locals captured by closures below.
    const buffered: Array<{ events: string[]; doc: DocPayload }> = [];
    let fetchSettled = false;

    // ── Stage 1: Open subscription BEFORE fetching so no events are missed ──
    this.unsubscribeChannel = this.client.subscribe(
      this.channel,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (response: any) => {
        const events = response.events as string[];
        const doc = response.payload as DocPayload;
        if ((doc.userId as string) !== userId) return;

        if (!fetchSettled) {
          // Fetch still in-flight — buffer for replay.
          buffered.push({ events, doc });
          return;
        }
        // Fetch complete — apply directly.
        // this.data is guaranteed non-null because fetchSettled is only set
        // after this.data is assigned (see Stage 2 below).
        this.data = this.applyEventToArray(this.data!, events, doc);
        this.notify();
      },
    );

    // ── Stage 2: Fetch initial snapshot AFTER subscribing ──
    void this.databases
      .listDocuments(DATABASE_ID, this.collectionId, [
        Query.equal('userId', userId),
        Query.limit(5000),
      ])
      .then((result) => {
        // Discard stale response if userId changed while fetch was in-flight.
        if (this.activeUserId !== userId) return;

        let items = result.documents.map((d) => this.mapper(d as DocPayload));

        // Replay buffered events on top of snapshot — order preserved.
        for (const { events, doc } of buffered) {
          items = this.applyEventToArray(items, events, doc);
        }
        buffered.length = 0;

        // Assign data before setting fetchSettled so the event handler's
        // non-null assertion on this.data is always valid.
        this.data = items;
        fetchSettled = true;
        this.notify();
      })
      .catch((err: unknown) => {
        console.error(`[UserDataStore:${this.collectionId}] fetch failed:`, err);
      });
  }
}

// ---------------------------------------------------------------------------
// React adapter — thin bridge between UserDataStore and React state.
// One instance of this hook per component consumer; all consumers share the
// same store (and therefore the same subscription).
// ---------------------------------------------------------------------------

function useStoreData<T extends { id: string }>(
  store: UserDataStore<T>,
  userId: string,
  enabled: boolean,
): T[] | undefined {
  const [data, setData] = useState<T[] | undefined>(undefined);

  useEffect(() => {
    if (!enabled || !userId) {
      setData(undefined);
      return;
    }

    const unsub = store.activate(userId, () => setData(store.getData()));
    // Sync immediately: if the store already has data (second consumer mounting
    // after the first has already fetched), the listener won't fire again.
    setData(store.getData());
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, enabled]);

  if (!enabled || !userId) return undefined;
  return data;
}

// ---------------------------------------------------------------------------
// Factory — call once at app startup (module level), not inside a component.
// ---------------------------------------------------------------------------

export function createAppwriteBackendHooks(client: Client): BackendHooks {
  const databases = new Databases(client);

  // One store per collection — singleton within this factory call.
  const notesStore = new UserDataStore<Note>(
    client,
    databases,
    NOTES_CHANNEL,
    NOTES_COLLECTION,
    mapRawDocToNote,
  );

  const subsStore = new UserDataStore<Subscription>(
    client,
    databases,
    SUBSCRIPTIONS_CHANNEL,
    SUBSCRIPTIONS_COLLECTION,
    mapRawDocToSubscription,
  );

  return {
    useNotes(userId: string, enabled = true): Note[] | undefined {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const all = useStoreData(notesStore, userId, enabled);
      return all?.filter((n) => n.active);
    },

    useAllNotes(userId: string, enabled = true): Note[] | undefined {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      return useStoreData(notesStore, userId, enabled);
    },

    useSubscriptions(userId: string): Subscription[] | undefined {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const all = useStoreData(subsStore, userId, true);
      return all?.filter((s) => !s.deletedAt);
    },

    useDeletedSubscriptions(userId: string, enabled = true): Subscription[] | undefined {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const all = useStoreData(subsStore, userId, enabled);
      return all?.filter((s) => Boolean(s.deletedAt));
    },
  };
}
