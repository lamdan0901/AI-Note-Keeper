/** Appwrite database ID for this project */
export const DATABASE_ID = 'ai-note-keeper';

/** Appwrite collection IDs */
export const NOTES_COLLECTION = 'notes';
export const NOTE_CHANGE_EVENTS_COLLECTION = 'noteChangeEvents';
export const SUBSCRIPTIONS_COLLECTION = 'subscriptions';
export const DEVICE_PUSH_TOKENS_COLLECTION = 'devicePushTokens';
export const CRON_STATE_COLLECTION = 'cronState';
export const MIGRATION_ATTEMPTS_COLLECTION = 'migrationAttempts';

/** Appwrite Realtime channel strings for subscribing to collection-level events */
export const NOTES_CHANNEL = `databases.${DATABASE_ID}.collections.${NOTES_COLLECTION}.documents`;
export const SUBSCRIPTIONS_CHANNEL = `databases.${DATABASE_ID}.collections.${SUBSCRIPTIONS_COLLECTION}.documents`;
