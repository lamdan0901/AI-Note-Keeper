import { Account, Databases, Functions, Query, ExecutionMethod } from 'appwrite';
import type {
  BackendClient,
  DevicePushTokenData,
  SyncNoteChange,
  SyncNotesResult,
  UserRecord,
} from './types';
import type { Note } from '../types/note';
import type { Reminder, ReminderCreate, ReminderUpdate } from '../types/reminder';
import type { Subscription, SubscriptionCreate, SubscriptionUpdate } from '../types/subscription';
import type { MergeSummary, MergeStrategy } from '../auth/userDataMerge';
import type {
  ContinueVoiceClarificationRequest,
  ParseVoiceNoteIntentRequest,
  VoiceIntentResponseDto,
} from '../types/voice';
import {
  getOrCreateAnonymousSession,
  loginUser,
  logoutUser,
  registerUser,
  validateCurrentSession,
} from '../appwrite/auth';
import { DATABASE_ID, NOTES_COLLECTION } from '../appwrite/collections';
import { coerceRepeatRule } from '../utils/repeatCodec';

// ---------------------------------------------------------------------------
// Internal doc mappers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDocToNote(doc: Record<string, any>): Note {
  const repeat = coerceRepeatRule({
    repeat: doc.repeat ? JSON.parse(doc.repeat as string) : undefined,
    repeatRule: doc.repeatRule,
    repeatConfig: doc.repeatConfig ? JSON.parse(doc.repeatConfig as string) : undefined,
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
    repeatConfig: doc.repeatConfig ? JSON.parse(doc.repeatConfig as string) : undefined,
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

// ---------------------------------------------------------------------------
// AppwriteBackendClient
//
// Implements BackendClient:
//   - Auth: implemented with Appwrite Account SDK
//   - Notes: getNotes/permanentlyDeleteNote/emptyTrash via Databases SDK;
//            syncNotes via notes-sync Function execution
//   - Reminders: all via reminders-api Function execution
//   - Subscriptions/Push/Voice: delegated to ConvexBackendClient (Phases 4–5)
// ---------------------------------------------------------------------------

export class AppwriteBackendClient implements BackendClient {
  constructor(
    private readonly account: Account,
    private readonly delegate: BackendClient,
    private readonly databases?: Databases,
    private readonly functions?: Functions,
    private readonly notesSyncFunctionId?: string,
    private readonly remindersApiFunctionId?: string,
  ) {}

  // ---------------------------------------------------------------------------
  // Auth — implemented with Appwrite
  // ---------------------------------------------------------------------------

  createAnonymousSession(): Promise<string> {
    return getOrCreateAnonymousSession(this.account);
  }

  logout(): Promise<void> {
    return logoutUser(this.account);
  }

  validateSession(userId: string): Promise<UserRecord | null> {
    return validateCurrentSession(this.account, userId);
  }

  login(username: string, password: string): Promise<UserRecord> {
    return loginUser(this.account, username, password);
  }

  register(username: string, password: string): Promise<UserRecord> {
    return registerUser(this.account, username, password);
  }

  // ---------------------------------------------------------------------------
  // All remaining methods — delegated to ConvexBackendClient until later phases
  // ---------------------------------------------------------------------------

  preflightUserDataMerge(
    fromUserId: string,
    toUserId: string,
    username: string,
    password: string,
  ): Promise<MergeSummary> {
    return this.delegate.preflightUserDataMerge(fromUserId, toUserId, username, password);
  }

  applyUserDataMerge(
    fromUserId: string,
    toUserId: string,
    username: string,
    password: string,
    strategy: MergeStrategy,
  ): Promise<void> {
    return this.delegate.applyUserDataMerge(fromUserId, toUserId, username, password, strategy);
  }

  getNotes(userId: string): Promise<Note[]> {
    if (this.databases) {
      return this.databases
        .listDocuments(DATABASE_ID, NOTES_COLLECTION, [Query.equal('userId', userId)])
        .then((result) => result.documents.map(mapDocToNote));
    }
    return this.delegate.getNotes(userId);
  }

  async syncNotes(
    userId: string,
    changes: SyncNoteChange[],
    lastSyncAt: number,
  ): Promise<SyncNotesResult> {
    if (this.functions && this.notesSyncFunctionId) {
      const execution = await this.functions.createExecution(
        this.notesSyncFunctionId,
        JSON.stringify({ userId, changes, lastSyncAt }),
        false,
        '/',
        ExecutionMethod.POST,
      );
      const parsed = JSON.parse(execution.responseBody) as {
        notes?: Array<{ id: string; version: number }>;
        syncedAt?: number;
        error?: string;
        status?: number;
      };
      if (parsed.error) {
        throw new Error(`syncNotes failed: ${parsed.error} (status ${parsed.status ?? 'unknown'})`);
      }
      return { notes: parsed.notes ?? [], syncedAt: parsed.syncedAt ?? Date.now() };
    }
    if (this.databases) {
      throw new Error(
        'syncNotes: Appwrite SDK is configured for reads but APPWRITE_NOTES_SYNC_FUNCTION_ID ' +
          'is missing. Set the env var to avoid split-backend writes.',
      );
    }
    return this.delegate.syncNotes(userId, changes, lastSyncAt);
  }

  async permanentlyDeleteNote(userId: string, noteId: string): Promise<void> {
    if (this.databases) {
      // Verify ownership before delete
      const result = await this.databases.listDocuments(DATABASE_ID, NOTES_COLLECTION, [
        Query.equal('userId', userId),
        Query.equal('$id', noteId),
      ]);
      const doc = result.documents[0];
      if (doc && doc.active === false) {
        await this.databases.deleteDocument(DATABASE_ID, NOTES_COLLECTION, noteId);
      }
      return;
    }
    return this.delegate.permanentlyDeleteNote(userId, noteId);
  }

  async emptyTrash(userId: string): Promise<void> {
    if (this.databases) {
      const result = await this.databases.listDocuments(DATABASE_ID, NOTES_COLLECTION, [
        Query.equal('userId', userId),
        Query.equal('active', false),
      ]);
      await Promise.all(
        result.documents.map((doc) =>
          this.databases!.deleteDocument(DATABASE_ID, NOTES_COLLECTION, doc.$id),
        ),
      );
      return;
    }
    return this.delegate.emptyTrash(userId);
  }

  // ---------------------------------------------------------------------------
  // Reminders — routed through reminders-api Function when available
  // ---------------------------------------------------------------------------

  private async callRemindersApi<T>(
    method: ExecutionMethod,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    if (!this.functions || !this.remindersApiFunctionId) {
      throw new Error('reminders-api function not configured');
    }
    const execution = await this.functions.createExecution(
      this.remindersApiFunctionId,
      body ? JSON.stringify(body) : '',
      false,
      path,
      method,
    );
    const parsed = JSON.parse(execution.responseBody) as T & { error?: string; status?: number };
    if ((parsed as { error?: string }).error) {
      throw new Error(
        `reminders-api error: ${(parsed as { error: string }).error} (status ${(parsed as { status?: number }).status ?? 'unknown'})`,
      );
    }
    return parsed;
  }

  getReminder(reminderId: string): Promise<Reminder | null> {
    if (this.functions && this.remindersApiFunctionId) {
      return this.callRemindersApi<Reminder>(ExecutionMethod.GET, `/${reminderId}`).catch(
        () => null,
      );
    }
    return this.delegate.getReminder(reminderId);
  }

  listReminders(updatedSince?: number): Promise<Reminder[]> {
    if (this.functions && this.remindersApiFunctionId) {
      const path = updatedSince !== undefined ? `/?updatedSince=${updatedSince}` : '/';
      return this.callRemindersApi<Reminder[]>(ExecutionMethod.GET, path);
    }
    return this.delegate.listReminders(updatedSince);
  }

  createReminder(data: ReminderCreate): Promise<Reminder> {
    if (this.functions && this.remindersApiFunctionId) {
      return this.callRemindersApi<Reminder>(
        ExecutionMethod.POST,
        '/',
        data as unknown as Record<string, unknown>,
      );
    }
    return this.delegate.createReminder(data);
  }

  updateReminder(id: string, patch: ReminderUpdate): Promise<Reminder | null> {
    if (this.functions && this.remindersApiFunctionId) {
      return this.callRemindersApi<Reminder>(
        ExecutionMethod.PATCH,
        `/${id}`,
        patch as unknown as Record<string, unknown>,
      ).catch(() => null);
    }
    return this.delegate.updateReminder(id, patch);
  }

  deleteReminder(id: string, deviceId?: string): Promise<void> {
    if (this.functions && this.remindersApiFunctionId) {
      return this.callRemindersApi<void>(
        ExecutionMethod.DELETE,
        `/${id}`,
        deviceId ? { deviceId } : undefined,
      );
    }
    return this.delegate.deleteReminder(id, deviceId);
  }

  snoozeReminder(id: string, snoozedUntil: number, deviceId?: string): Promise<Reminder | null> {
    if (this.functions && this.remindersApiFunctionId) {
      return this.callRemindersApi<Reminder>(ExecutionMethod.POST, `/${id}/snooze`, {
        snoozedUntil,
        ...(deviceId ? { deviceId } : {}),
      }).catch(() => null);
    }
    return this.delegate.snoozeReminder(id, snoozedUntil, deviceId);
  }

  ackReminder(
    id: string,
    ackType: string,
    opts?: { optimisticNextTrigger?: number },
  ): Promise<void> {
    if (this.functions && this.remindersApiFunctionId) {
      return this.callRemindersApi<void>(ExecutionMethod.POST, `/${id}/ack`, {
        ackType,
        ...(opts?.optimisticNextTrigger !== undefined
          ? { optimisticNextTrigger: opts.optimisticNextTrigger }
          : {}),
      });
    }
    return this.delegate.ackReminder(id, ackType, opts);
  }

  listSubscriptions(userId: string): Promise<Subscription[]> {
    return this.delegate.listSubscriptions(userId);
  }

  listDeletedSubscriptions(userId: string): Promise<Subscription[]> {
    return this.delegate.listDeletedSubscriptions(userId);
  }

  createSubscription(data: SubscriptionCreate): Promise<string> {
    return this.delegate.createSubscription(data);
  }

  updateSubscription(id: string, patch: SubscriptionUpdate): Promise<void> {
    return this.delegate.updateSubscription(id, patch);
  }

  deleteSubscription(id: string): Promise<void> {
    return this.delegate.deleteSubscription(id);
  }

  restoreSubscription(id: string): Promise<void> {
    return this.delegate.restoreSubscription(id);
  }

  permanentlyDeleteSubscription(id: string): Promise<void> {
    return this.delegate.permanentlyDeleteSubscription(id);
  }

  emptySubscriptionTrash(userId: string): Promise<void> {
    return this.delegate.emptySubscriptionTrash(userId);
  }

  upsertDevicePushToken(data: DevicePushTokenData): Promise<void> {
    return this.delegate.upsertDevicePushToken(data);
  }

  parseVoiceNoteIntent(data: ParseVoiceNoteIntentRequest): Promise<VoiceIntentResponseDto> {
    return this.delegate.parseVoiceNoteIntent(data);
  }

  continueVoiceClarification(
    data: ContinueVoiceClarificationRequest,
  ): Promise<VoiceIntentResponseDto> {
    return this.delegate.continueVoiceClarification(data);
  }
}
