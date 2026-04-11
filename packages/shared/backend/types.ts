import type { Note, NoteContentType } from '../types/note';
import type { Reminder, RepeatRule } from '../types/reminder';
import type { Subscription, SubscriptionCreate, SubscriptionUpdate } from '../types/subscription';
import type { MergeSummary, MergeStrategy } from '../auth/userDataMerge';
import type {
  ParseVoiceNoteIntentRequest,
  ContinueVoiceClarificationRequest,
  VoiceIntentResponseDto,
} from '../types/voice';

// ---------------------------------------------------------------------------
// Shared return types
// ---------------------------------------------------------------------------

export type UserRecord = {
  userId: string;
  username: string;
};

export type SyncNoteChange = {
  id: string;
  userId: string;
  title?: string;
  content?: string;
  contentType?: NoteContentType;
  color?: string;
  active: boolean;
  done?: boolean;
  isPinned?: boolean;
  triggerAt?: number;
  repeatRule?: 'none' | 'daily' | 'weekly' | 'monthly' | 'custom';
  repeatConfig?: Record<string, unknown> | null;
  snoozedUntil?: number;
  scheduleStatus?: 'scheduled' | 'unscheduled' | 'error';
  timezone?: string;
  repeat?: RepeatRule | null;
  startAt?: number | null;
  baseAtLocal?: string | null;
  nextTriggerAt?: number | null;
  lastFiredAt?: number | null;
  lastAcknowledgedAt?: number | null;
  deletedAt?: number;
  updatedAt: number;
  createdAt: number;
  operation: 'create' | 'update' | 'delete';
  deviceId: string;
  version?: number;
  baseVersion?: number;
};

export type SyncNotesResult = {
  notes: Array<{ id: string; version: number }>;
  syncedAt: number;
};

export type DevicePushTokenData = {
  id: string;
  userId: string;
  deviceId: string;
  fcmToken: string;
  platform: 'android';
  updatedAt: number;
};

// ---------------------------------------------------------------------------
// BackendClient — imperative async methods (safe to call outside React hooks)
// ---------------------------------------------------------------------------

export interface BackendClient {
  // Auth
  createAnonymousSession(): Promise<string>;
  logout(): Promise<void>;
  validateSession(userId: string): Promise<UserRecord | null>;
  login(username: string, password: string): Promise<UserRecord>;
  register(username: string, password: string): Promise<UserRecord>;

  // Merge
  preflightUserDataMerge(
    fromUserId: string,
    toUserId: string,
    username: string,
    password: string,
  ): Promise<MergeSummary>;
  applyUserDataMerge(
    fromUserId: string,
    toUserId: string,
    username: string,
    password: string,
    strategy: MergeStrategy,
  ): Promise<void>;

  // Notes
  getNotes(userId: string): Promise<Note[]>;
  syncNotes(
    userId: string,
    changes: SyncNoteChange[],
    lastSyncAt: number,
  ): Promise<SyncNotesResult>;
  permanentlyDeleteNote(userId: string, noteId: string): Promise<void>;
  emptyTrash(userId: string): Promise<void>;

  // Reminders
  getReminder(reminderId: string): Promise<Reminder | null>;
  ackReminder(
    id: string,
    ackType: string,
    opts?: { optimisticNextTrigger?: number },
  ): Promise<void>;

  // Subscriptions — full CRUD (used by mobile/web service mutation helpers)
  listSubscriptions(userId: string): Promise<Subscription[]>;
  listDeletedSubscriptions(userId: string): Promise<Subscription[]>;
  createSubscription(data: SubscriptionCreate): Promise<string>;
  updateSubscription(id: string, patch: SubscriptionUpdate): Promise<void>;
  deleteSubscription(id: string): Promise<void>;
  restoreSubscription(id: string): Promise<void>;
  permanentlyDeleteSubscription(id: string): Promise<void>;
  emptySubscriptionTrash(userId: string): Promise<void>;

  // Push
  upsertDevicePushToken(data: DevicePushTokenData): Promise<void>;

  // Voice AI
  parseVoiceNoteIntent(data: ParseVoiceNoteIntentRequest): Promise<VoiceIntentResponseDto>;
  continueVoiceClarification(
    data: ContinueVoiceClarificationRequest,
  ): Promise<VoiceIntentResponseDto>;
}

// ---------------------------------------------------------------------------
// BackendHooks — React hook methods (MUST be called at top level of hooks/components)
// ---------------------------------------------------------------------------

export interface BackendHooks {
  useNotes(userId: string, enabled?: boolean): Note[] | undefined;
  useAllNotes(userId: string, enabled?: boolean): Note[] | undefined;
  useSubscriptions(userId: string): Subscription[] | undefined;
  useDeletedSubscriptions(userId: string, enabled?: boolean): Subscription[] | undefined;
}
