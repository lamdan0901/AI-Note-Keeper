import { Account, Databases, Functions, ID, Query, ExecutionMethod } from 'appwrite';
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
    private readonly delegate?: BackendClient,
    private readonly databases?: Databases,
    private readonly functions?: Functions,
    private readonly notesSyncFunctionId?: string,
    private readonly remindersApiFunctionId?: string,
    private readonly subscriptionsApiFunctionId?: string,
    private readonly aiVoiceFunctionId?: string,
    private readonly userDataMigrationFunctionId?: string,
    private readonly fcmProviderId?: string,
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
    if (this.functions && this.userDataMigrationFunctionId) {
      return this.functions
        .createExecution(
          this.userDataMigrationFunctionId,
          JSON.stringify({ fromUserId, toUserId, username, password }),
          false,
          '/preflight',
          ExecutionMethod.POST,
        )
        .then((exec) => {
          const parsed = JSON.parse(exec.responseBody) as MergeSummary & {
            error?: string;
            status?: number;
          };
          if (parsed.error) {
            throw new Error(
              `user-data-migration preflight error: ${parsed.error} (status ${
                parsed.status ?? 'unknown'
              })`,
            );
          }
          return parsed;
        });
    }
    if (this.delegate)
      return this.delegate.preflightUserDataMerge(fromUserId, toUserId, username, password);
    throw new Error(
      'preflightUserDataMerge: neither userDataMigrationFunctionId nor delegate is configured',
    );
  }

  applyUserDataMerge(
    fromUserId: string,
    toUserId: string,
    username: string,
    password: string,
    strategy: MergeStrategy,
  ): Promise<void> {
    if (this.functions && this.userDataMigrationFunctionId) {
      return this.functions
        .createExecution(
          this.userDataMigrationFunctionId,
          JSON.stringify({ fromUserId, toUserId, username, password, strategy }),
          false,
          '/apply',
          ExecutionMethod.POST,
        )
        .then((exec) => {
          const parsed = JSON.parse(exec.responseBody) as {
            error?: string;
            status?: number;
          };
          if (parsed.error) {
            throw new Error(
              `user-data-migration apply error: ${parsed.error} (status ${
                parsed.status ?? 'unknown'
              })`,
            );
          }
        });
    }
    if (this.delegate)
      return this.delegate.applyUserDataMerge(fromUserId, toUserId, username, password, strategy);
    throw new Error(
      'applyUserDataMerge: neither userDataMigrationFunctionId nor delegate is configured',
    );
  }

  getNotes(userId: string): Promise<Note[]> {
    if (this.databases) {
      return this.databases
        .listDocuments(DATABASE_ID, NOTES_COLLECTION, [Query.equal('userId', userId)])
        .then((result) => result.documents.map(mapDocToNote));
    }
    if (this.delegate) return this.delegate.getNotes(userId);
    throw new Error('getNotes: neither databases nor delegate is configured');
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
    return (
      this.delegate?.syncNotes(userId, changes, lastSyncAt) ??
      Promise.reject(new Error('syncNotes: neither notesSyncFunctionId nor delegate is configured'))
    );
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
    if (this.delegate) return this.delegate.permanentlyDeleteNote(userId, noteId);
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
    if (this.delegate) return this.delegate.emptyTrash(userId);
  }

  // ---------------------------------------------------------------------------
  // Reminders — routed through reminders-api Function when available
  // ---------------------------------------------------------------------------

  private async callSubscriptionsApi<T>(
    method: ExecutionMethod,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    if (!this.functions || !this.subscriptionsApiFunctionId) {
      throw new Error('subscriptions-api function not configured');
    }
    const execution = await this.functions.createExecution(
      this.subscriptionsApiFunctionId,
      body ? JSON.stringify(body) : '',
      false,
      path,
      method,
    );
    const parsed = JSON.parse(execution.responseBody) as T & { error?: string; status?: number };
    if ((parsed as { error?: string }).error) {
      throw new Error(
        `subscriptions-api error: ${(parsed as { error: string }).error} (status ${
          (parsed as { status?: number }).status ?? 'unknown'
        })`,
      );
    }
    return parsed;
  }

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
    if (this.delegate) return this.delegate.getReminder(reminderId);
    throw new Error('getReminder: neither remindersApiFunctionId nor delegate is configured');
  }

  listReminders(updatedSince?: number): Promise<Reminder[]> {
    if (this.functions && this.remindersApiFunctionId) {
      const path = updatedSince !== undefined ? `/?updatedSince=${updatedSince}` : '/';
      return this.callRemindersApi<Reminder[]>(ExecutionMethod.GET, path);
    }
    if (this.delegate) return this.delegate.listReminders(updatedSince);
    throw new Error('listReminders: neither remindersApiFunctionId nor delegate is configured');
  }

  createReminder(data: ReminderCreate): Promise<Reminder> {
    if (this.functions && this.remindersApiFunctionId) {
      return this.callRemindersApi<Reminder>(
        ExecutionMethod.POST,
        '/',
        data as unknown as Record<string, unknown>,
      );
    }
    if (this.delegate) return this.delegate.createReminder(data);
    throw new Error('createReminder: neither remindersApiFunctionId nor delegate is configured');
  }

  updateReminder(id: string, patch: ReminderUpdate): Promise<Reminder | null> {
    if (this.functions && this.remindersApiFunctionId) {
      return this.callRemindersApi<Reminder>(
        ExecutionMethod.PATCH,
        `/${id}`,
        patch as unknown as Record<string, unknown>,
      ).catch(() => null);
    }
    if (this.delegate) return this.delegate.updateReminder(id, patch);
    throw new Error('updateReminder: neither remindersApiFunctionId nor delegate is configured');
  }

  deleteReminder(id: string, deviceId?: string): Promise<void> {
    if (this.functions && this.remindersApiFunctionId) {
      return this.callRemindersApi<void>(
        ExecutionMethod.DELETE,
        `/${id}`,
        deviceId ? { deviceId } : undefined,
      );
    }
    if (this.delegate) return this.delegate.deleteReminder(id, deviceId);
    throw new Error('deleteReminder: neither remindersApiFunctionId nor delegate is configured');
  }

  snoozeReminder(id: string, snoozedUntil: number, deviceId?: string): Promise<Reminder | null> {
    if (this.functions && this.remindersApiFunctionId) {
      return this.callRemindersApi<Reminder>(ExecutionMethod.POST, `/${id}/snooze`, {
        snoozedUntil,
        ...(deviceId ? { deviceId } : {}),
      }).catch(() => null);
    }
    if (this.delegate) return this.delegate.snoozeReminder(id, snoozedUntil, deviceId);
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
    if (this.delegate) return this.delegate.ackReminder(id, ackType, opts);
  }

  listSubscriptions(userId: string): Promise<Subscription[]> {
    if (this.functions && this.subscriptionsApiFunctionId) {
      return this.callSubscriptionsApi<Subscription[]>(
        ExecutionMethod.GET,
        `/subscriptions?userId=${encodeURIComponent(userId)}`,
      );
    }
    if (this.delegate) return this.delegate.listSubscriptions(userId);
    throw new Error(
      'listSubscriptions: neither subscriptionsApiFunctionId nor delegate is configured',
    );
  }

  listDeletedSubscriptions(userId: string): Promise<Subscription[]> {
    if (this.functions && this.subscriptionsApiFunctionId) {
      return this.callSubscriptionsApi<Subscription[]>(
        ExecutionMethod.GET,
        `/subscriptions/deleted?userId=${encodeURIComponent(userId)}`,
      );
    }
    if (this.delegate) return this.delegate.listDeletedSubscriptions(userId);
    throw new Error(
      'listDeletedSubscriptions: neither subscriptionsApiFunctionId nor delegate is configured',
    );
  }

  createSubscription(data: SubscriptionCreate): Promise<string> {
    if (this.functions && this.subscriptionsApiFunctionId) {
      return this.callSubscriptionsApi<{ id: string }>(
        ExecutionMethod.POST,
        '/subscriptions',
        data as unknown as Record<string, unknown>,
      ).then((r) => r.id);
    }
    if (this.delegate) return this.delegate.createSubscription(data);
    throw new Error(
      'createSubscription: neither subscriptionsApiFunctionId nor delegate is configured',
    );
  }

  updateSubscription(id: string, patch: SubscriptionUpdate): Promise<void> {
    if (this.functions && this.subscriptionsApiFunctionId) {
      return this.callSubscriptionsApi<void>(
        ExecutionMethod.PATCH,
        `/subscriptions/${id}`,
        patch as unknown as Record<string, unknown>,
      );
    }
    if (this.delegate) return this.delegate.updateSubscription(id, patch);
    throw new Error(
      'updateSubscription: neither subscriptionsApiFunctionId nor delegate is configured',
    );
  }

  deleteSubscription(id: string): Promise<void> {
    if (this.functions && this.subscriptionsApiFunctionId) {
      return this.callSubscriptionsApi<void>(ExecutionMethod.DELETE, `/subscriptions/${id}`);
    }
    if (this.delegate) return this.delegate.deleteSubscription(id);
    throw new Error(
      'deleteSubscription: neither subscriptionsApiFunctionId nor delegate is configured',
    );
  }

  restoreSubscription(id: string): Promise<void> {
    if (this.functions && this.subscriptionsApiFunctionId) {
      return this.callSubscriptionsApi<void>(ExecutionMethod.POST, `/subscriptions/${id}/restore`);
    }
    if (this.delegate) return this.delegate.restoreSubscription(id);
    throw new Error(
      'restoreSubscription: neither subscriptionsApiFunctionId nor delegate is configured',
    );
  }

  permanentlyDeleteSubscription(id: string): Promise<void> {
    if (this.functions && this.subscriptionsApiFunctionId) {
      return this.callSubscriptionsApi<void>(
        ExecutionMethod.POST,
        `/subscriptions/${id}/permanent-delete`,
      );
    }
    if (this.delegate) return this.delegate.permanentlyDeleteSubscription(id);
    throw new Error(
      'permanentlyDeleteSubscription: neither subscriptionsApiFunctionId nor delegate is configured',
    );
  }

  emptySubscriptionTrash(userId: string): Promise<void> {
    if (this.functions && this.subscriptionsApiFunctionId) {
      return this.callSubscriptionsApi<void>(
        ExecutionMethod.DELETE,
        `/subscriptions/trash?userId=${encodeURIComponent(userId)}`,
      );
    }
    if (this.delegate) return this.delegate.emptySubscriptionTrash(userId);
    throw new Error(
      'emptySubscriptionTrash: neither subscriptionsApiFunctionId nor delegate is configured',
    );
  }

  async upsertDevicePushToken(data: DevicePushTokenData): Promise<void> {
    // Use data.deviceId as the Appwrite push target ID for deterministic upsert.
    // identifier is the FCM token; providerId is the FCM messaging provider.
    try {
      await this.account.createPushTarget(data.deviceId, data.fcmToken, this.fcmProviderId);
    } catch {
      // Target already exists — update the FCM token
      await this.account.updatePushTarget(data.deviceId, data.fcmToken);
    }
  }

  parseVoiceNoteIntent(data: ParseVoiceNoteIntentRequest): Promise<VoiceIntentResponseDto> {
    if (this.functions && this.aiVoiceFunctionId) {
      return this.functions
        .createExecution(
          this.aiVoiceFunctionId,
          JSON.stringify(data),
          false,
          '/parse',
          ExecutionMethod.POST,
        )
        .then((exec) => {
          const parsed = JSON.parse(exec.responseBody) as VoiceIntentResponseDto & {
            error?: string;
            status?: number;
          };
          if (parsed.error) {
            throw new Error(
              `ai-voice-capture parse error: ${parsed.error} (status ${
                parsed.status ?? 'unknown'
              })`,
            );
          }
          return parsed;
        });
    }
    if (this.delegate) return this.delegate.parseVoiceNoteIntent(data);
    throw new Error('parseVoiceNoteIntent: neither aiVoiceFunctionId nor delegate is configured');
  }

  continueVoiceClarification(
    data: ContinueVoiceClarificationRequest,
  ): Promise<VoiceIntentResponseDto> {
    if (this.functions && this.aiVoiceFunctionId) {
      return this.functions
        .createExecution(
          this.aiVoiceFunctionId,
          JSON.stringify(data),
          false,
          '/clarify',
          ExecutionMethod.POST,
        )
        .then((exec) => {
          const parsed = JSON.parse(exec.responseBody) as VoiceIntentResponseDto & {
            error?: string;
            status?: number;
          };
          if (parsed.error) {
            throw new Error(
              `ai-voice-capture clarify error: ${parsed.error} (status ${
                parsed.status ?? 'unknown'
              })`,
            );
          }
          return parsed;
        });
    }
    if (this.delegate) return this.delegate.continueVoiceClarification(data);
    throw new Error(
      'continueVoiceClarification: neither aiVoiceFunctionId nor delegate is configured',
    );
  }
}
