/**
 * ConvexBackendClient — implements BackendClient by wrapping ConvexHttpClient calls.
 * convexBackendHooks — implements BackendHooks using Convex useQuery.
 *
 * These are the ONLY files allowed to import from convex/* and convex/_generated.
 * All other app code must use BackendClient / BackendHooks through context.
 */

import { ConvexHttpClient } from 'convex/browser';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';

import type { Note } from '../types/note';
import type { Reminder } from '../types/reminder';
import type { Subscription, SubscriptionCreate, SubscriptionUpdate } from '../types/subscription';
import type {
  ParseVoiceNoteIntentRequest,
  ContinueVoiceClarificationRequest,
  VoiceIntentResponseDto,
} from '../types/voice';
import { coerceRepeatRule } from '../utils/repeatCodec';
import type {
  BackendClient,
  BackendHooks,
  DevicePushTokenData,
  SyncNoteChange,
  SyncNotesResult,
  UserRecord,
} from './types';

// ---------------------------------------------------------------------------
// Internal doc mappers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDocToNote(doc: any): Note {
  const repeat = coerceRepeatRule({
    repeat: doc.repeat,
    repeatRule: doc.repeatRule,
    repeatConfig: doc.repeatConfig,
    triggerAt: doc.triggerAt,
  });

  return {
    id: doc.id as string,
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
    repeatConfig: doc.repeatConfig ?? undefined,
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
function mapDocToSubscription(doc: any): Subscription {
  return {
    id: doc._id as string,
    userId: doc.userId as string,
    serviceName: doc.serviceName as string,
    category: doc.category,
    price: doc.price as number,
    currency: doc.currency as string,
    billingCycle: doc.billingCycle,
    billingCycleCustomDays: doc.billingCycleCustomDays,
    nextBillingDate: doc.nextBillingDate as number,
    notes: doc.notes,
    trialEndDate: doc.trialEndDate,
    status: doc.status,
    reminderDaysBefore: doc.reminderDaysBefore as number[],
    nextReminderAt: doc.nextReminderAt,
    lastNotifiedBillingDate: doc.lastNotifiedBillingDate,
    nextTrialReminderAt: doc.nextTrialReminderAt,
    lastNotifiedTrialEndDate: doc.lastNotifiedTrialEndDate,
    active: doc.active as boolean,
    deletedAt: doc.deletedAt ?? undefined,
    createdAt: doc.createdAt as number,
    updatedAt: doc.updatedAt as number,
  };
}

// ---------------------------------------------------------------------------
// ConvexBackendClient
// ---------------------------------------------------------------------------

export class ConvexBackendClient implements BackendClient {
  private readonly client: ConvexHttpClient;

  constructor(convexUrl: string) {
    this.client = new ConvexHttpClient(convexUrl);
  }

  // Auth

  async createAnonymousSession(): Promise<string> {
    return '';
  }

  async logout(): Promise<void> {}

  async validateSession(userId: string): Promise<UserRecord | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const authApi = (api.functions as any).auth;
    if (!authApi?.validateSession) return null;
    const user = await this.client.query(authApi.validateSession, { userId });
    return (user as UserRecord | null) ?? null;
  }

  async login(username: string, password: string): Promise<UserRecord> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const authApi = (api.functions as any).auth;
    const result = await this.client.mutation(authApi.login, { username, password });
    return result as UserRecord;
  }

  async register(username: string, password: string): Promise<UserRecord> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const authApi = (api.functions as any).auth;
    const result = await this.client.mutation(authApi.register, { username, password });
    return result as UserRecord;
  }

  // Merge

  async preflightUserDataMerge(
    fromUserId: string,
    toUserId: string,
    username: string,
    password: string,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const migrationApi = (api.functions as any).userDataMigration;
    const result = await this.client.mutation(migrationApi.preflightUserDataMerge, {
      fromUserId,
      toUserId,
      username,
      password,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result as any;
  }

  async applyUserDataMerge(
    fromUserId: string,
    toUserId: string,
    username: string,
    password: string,
    strategy: string,
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const migrationApi = (api.functions as any).userDataMigration;
    await this.client.mutation(migrationApi.applyUserDataMerge, {
      fromUserId,
      toUserId,
      username,
      password,
      strategy,
    });
  }

  // Notes

  async getNotes(userId: string): Promise<Note[]> {
    const docs = await this.client.query(api.functions.notes.getNotes, { userId });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (docs as any[]).map(mapDocToNote);
  }

  async syncNotes(
    userId: string,
    changes: SyncNoteChange[],
    lastSyncAt: number,
  ): Promise<SyncNotesResult> {
    const result = await this.client.mutation(api.functions.notes.syncNotes, {
      userId,
      changes,
      lastSyncAt,
    });
    return result as unknown as SyncNotesResult;
  }

  async permanentlyDeleteNote(userId: string, noteId: string): Promise<void> {
    await this.client.mutation(api.functions.notes.permanentlyDeleteNote, { userId, noteId });
  }

  async emptyTrash(userId: string): Promise<void> {
    await this.client.mutation(api.functions.notes.emptyTrash, { userId });
  }

  // Reminders

  async getReminder(reminderId: string): Promise<Reminder | null> {
    const doc = await this.client.query(api.functions.reminders.getReminder, { reminderId });
    return (doc as Reminder | null) ?? null;
  }

  async ackReminder(
    id: string,
    ackType: string,
    opts?: { optimisticNextTrigger?: number },
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const remindersApi = (api.functions as any).reminders;
    await this.client.mutation(remindersApi.ackReminder, {
      id,
      ackType,
      optimisticNextTrigger: opts?.optimisticNextTrigger,
    });
  }

  // Subscriptions

  async listSubscriptions(userId: string): Promise<Subscription[]> {
    const docs = await this.client.query(api.functions.subscriptions.listSubscriptions, { userId });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (docs as any[]).map(mapDocToSubscription);
  }

  async listDeletedSubscriptions(userId: string): Promise<Subscription[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subscriptionsApi = (api.functions as any).subscriptions;
    const docs = await this.client.query(subscriptionsApi.listDeletedSubscriptions, { userId });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (docs as any[]).map(mapDocToSubscription);
  }

  async createSubscription(data: SubscriptionCreate): Promise<string> {
    const createdId = await this.client.mutation(
      api.functions.subscriptions.createSubscription,
      data,
    );
    return createdId as string;
  }

  async updateSubscription(id: string, patch: SubscriptionUpdate): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.client.mutation(api.functions.subscriptions.updateSubscription, {
      id: id as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      patch,
    });
  }

  async deleteSubscription(id: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.client.mutation(api.functions.subscriptions.deleteSubscription, { id: id as any });
  }

  async restoreSubscription(id: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subscriptionsApi = (api.functions as any).subscriptions;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.client.mutation(subscriptionsApi.restoreSubscription, { id: id as any });
  }

  async permanentlyDeleteSubscription(id: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subscriptionsApi = (api.functions as any).subscriptions;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.client.mutation(subscriptionsApi.permanentlyDeleteSubscription, { id: id as any });
  }

  async emptySubscriptionTrash(userId: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subscriptionsApi = (api.functions as any).subscriptions;
    await this.client.mutation(subscriptionsApi.emptySubscriptionTrash, { userId });
  }

  // Push

  async upsertDevicePushToken(data: DevicePushTokenData): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deviceTokensApi = (api.functions as any).deviceTokens;
    await this.client.mutation(deviceTokensApi.upsertDevicePushToken, data);
  }

  // Voice AI

  async parseVoiceNoteIntent(data: ParseVoiceNoteIntentRequest): Promise<VoiceIntentResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aiApi = (api.functions as any).aiNoteCapture;
    const result = await this.client.action(aiApi.parseVoiceNoteIntent, {
      ...data,
      locale: data.locale,
    });
    return result as VoiceIntentResponseDto;
  }

  async continueVoiceClarification(
    data: ContinueVoiceClarificationRequest,
  ): Promise<VoiceIntentResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aiApi = (api.functions as any).aiNoteCapture;
    const result = await this.client.action(aiApi.continueVoiceClarification, data);
    return result as VoiceIntentResponseDto;
  }
}

// ---------------------------------------------------------------------------
// Factory — creates a ConvexBackendClient from env; returns null if URL absent.
// Use this in non-React contexts (headless tasks, background workers).
// ---------------------------------------------------------------------------

export function createConvexBackendClient(urlOverride?: string): ConvexBackendClient | null {
  // Babel inlines process.env.EXPO_PUBLIC_CONVEX_URL at build time on RN.
  // The direct access pattern must not use optional chaining.
  const url = urlOverride ?? process.env.EXPO_PUBLIC_CONVEX_URL;
  if (!url) return null;
  return new ConvexBackendClient(url);
}

// ---------------------------------------------------------------------------
// convexBackendHooks — implements BackendHooks via Convex useQuery.
// Methods in this object are REACT HOOKS — call only at top level of components/hooks.
// ---------------------------------------------------------------------------

export const convexBackendHooks: BackendHooks = {
  useNotes(userId: string, enabled = true): Note[] | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = useQuery(api.functions.notes.getNotes, enabled ? { userId } : 'skip');
    if (raw === undefined) return undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (raw as any[]).map(mapDocToNote).filter((note: Note) => note.active);
  },

  useAllNotes(userId: string, enabled = true): Note[] | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = useQuery(api.functions.notes.getNotes, enabled ? { userId } : 'skip');
    if (raw === undefined) return undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (raw as any[]).map(mapDocToNote);
  },

  useSubscriptions(userId: string): Subscription[] | undefined {
    const raw = useQuery(api.functions.subscriptions.listSubscriptions, { userId });
    if (raw === undefined) return undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (raw as any[]).map(mapDocToSubscription);
  },

  useDeletedSubscriptions(userId: string, enabled = true): Subscription[] | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subscriptionsApi = (api.functions as any).subscriptions;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = useQuery(subscriptionsApi.listDeletedSubscriptions, enabled ? { userId } : 'skip');
    if (raw === undefined) return undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (raw as any[]).map(mapDocToSubscription);
  },
};
