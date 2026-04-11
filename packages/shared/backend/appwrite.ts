import { Account } from 'appwrite';
import type {
  BackendClient,
  DevicePushTokenData,
  SyncNoteChange,
  SyncNotesResult,
  UserRecord,
} from './types';
import type { Note } from '../types/note';
import type { Reminder } from '../types/reminder';
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

// ---------------------------------------------------------------------------
// AppwriteBackendClient
//
// Implements BackendClient with Appwrite handling auth and delegating all
// other methods (notes, reminders, subscriptions, push, voice) to a
// ConvexBackendClient until those are migrated in Phases 3–5.
// ---------------------------------------------------------------------------

export class AppwriteBackendClient implements BackendClient {
  constructor(
    private readonly account: Account,
    private readonly delegate: BackendClient,
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
    return this.delegate.getNotes(userId);
  }

  syncNotes(
    userId: string,
    changes: SyncNoteChange[],
    lastSyncAt: number,
  ): Promise<SyncNotesResult> {
    return this.delegate.syncNotes(userId, changes, lastSyncAt);
  }

  permanentlyDeleteNote(userId: string, noteId: string): Promise<void> {
    return this.delegate.permanentlyDeleteNote(userId, noteId);
  }

  emptyTrash(userId: string): Promise<void> {
    return this.delegate.emptyTrash(userId);
  }

  getReminder(reminderId: string): Promise<Reminder | null> {
    return this.delegate.getReminder(reminderId);
  }

  ackReminder(
    id: string,
    ackType: string,
    opts?: { optimisticNextTrigger?: number },
  ): Promise<void> {
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
