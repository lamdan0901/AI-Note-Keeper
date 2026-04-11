/**
 * Appwrite document shapes.
 *
 * Appwrite adds system fields ($id, $collectionId, $databaseId, $createdAt,
 * $updatedAt, $permissions) to every document. We map only the ones we use.
 *
 * Important serialisation rules:
 *  - `repeat` / `repeatConfig` are stored as JSON strings (Appwrite has no nested-object type)
 *  - `reminderDaysBefore` is stored as a JSON string (no integer-array type)
 *  - `$id` for `notes` documents equals the app-level `id` UUID
 *  - All timestamps are epoch-millisecond integers
 */

// ---------------------------------------------------------------------------
// Base system fields present on every Appwrite document
// ---------------------------------------------------------------------------
interface AppwriteDocument {
  $id: string;
  $collectionId: string;
  $databaseId: string;
  $createdAt: string;
  $updatedAt: string;
  $permissions: string[];
}

// ---------------------------------------------------------------------------
// notes collection — unified notes + reminders
// ---------------------------------------------------------------------------
export interface AppwriteNote extends AppwriteDocument {
  // $id === app id (UUID)
  userId: string;
  title: string | null;
  content: string | null;
  contentType: string | null; // 'text' | 'checklist'
  color: string | null;
  active: boolean;
  done: boolean;
  isPinned: boolean;

  // Reminder fields — legacy
  triggerAt: number | null;
  repeatRule: string | null; // 'none' | 'daily' | 'weekly' | 'monthly' | 'custom'
  repeatConfig: string | null; // JSON-serialised Record<string, unknown>

  // Reminder fields — new
  repeat: string | null; // JSON-serialised RepeatRule
  baseAtLocal: string | null; // ISO datetime string "2026-02-01T09:00"
  startAt: number | null;
  nextTriggerAt: number | null;
  lastFiredAt: number | null;
  lastAcknowledgedAt: number | null;
  snoozedUntil: number | null;
  scheduleStatus: string | null; // 'scheduled' | 'unscheduled' | 'error'
  timezone: string | null;

  version: number;
  deletedAt: number | null;
  updatedAt: number;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// noteChangeEvents collection — sync ledger / audit trail
// ---------------------------------------------------------------------------
export interface AppwriteNoteChangeEvent extends AppwriteDocument {
  noteId: string;
  userId: string;
  operation: string; // 'create' | 'update' | 'delete'
  changedAt: number;
  deviceId: string | null;
  payloadHash: string | null;
}

// ---------------------------------------------------------------------------
// subscriptions collection — billing reminder subscriptions
// ---------------------------------------------------------------------------
export interface AppwriteSubscription extends AppwriteDocument {
  userId: string;
  serviceName: string;
  category: string | null;
  price: number;
  currency: string;
  billingCycle: string; // 'weekly' | 'monthly' | 'yearly' | 'custom'
  billingCycleCustomDays: number | null;
  nextBillingDate: number;
  trialEndDate: number | null;
  status: string; // 'active' | 'cancelled' | 'paused'
  reminderDaysBefore: string; // JSON-serialised number[] e.g. "[3,7]"
  nextReminderAt: number | null;
  lastNotifiedBillingDate: number | null;
  nextTrialReminderAt: number | null;
  lastNotifiedTrialEndDate: number | null;
  active: boolean;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// devicePushTokens collection — FCM registration tokens
// ---------------------------------------------------------------------------
export interface AppwriteDevicePushToken extends AppwriteDocument {
  userId: string;
  deviceId: string;
  fcmToken: string;
  platform: string; // 'android'
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// cronState collection — watermarks for scheduled jobs
// ($id === key, e.g. "check-reminders")
// ---------------------------------------------------------------------------
export interface AppwriteCronState extends AppwriteDocument {
  key: string;
  lastCheckedAt: number;
}

// ---------------------------------------------------------------------------
// migrationAttempts collection — rate-limiting for data-merge operations
// ($id === key, userId-derived)
// ---------------------------------------------------------------------------
export interface AppwriteMigrationAttempt extends AppwriteDocument {
  key: string;
  attempts: number;
  lastAttemptAt: number;
  blockedUntil: number | null;
}
