/**
 * Module-level BackendClient singleton for use in headless/background tasks
 * where React context is not available.
 *
 * The client is lazily constructed on first access using the same env vars
 * as App.tsx.
 */
import { Account, Databases, Functions } from 'appwrite';
import { ConvexBackendClient } from '../../../../packages/shared/backend/convex';
import { AppwriteBackendClient } from '../../../../packages/shared/backend/appwrite';
import { createAppwriteClient } from '../../../../packages/shared/appwrite/client';
import type { BackendClient } from '../../../../packages/shared/backend/types';

let _client: BackendClient | null = null;

export const getBackendClient = (): BackendClient | null => {
  if (_client) return _client;

  const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
  const appwriteEndpoint = process.env.EXPO_PUBLIC_APPWRITE_ENDPOINT;
  const appwriteProjectId = process.env.EXPO_PUBLIC_APPWRITE_PROJECT_ID;
  const notesSyncFunctionId = process.env.EXPO_PUBLIC_APPWRITE_NOTES_SYNC_FUNCTION_ID;
  const remindersApiFunctionId = process.env.EXPO_PUBLIC_APPWRITE_REMINDERS_API_FUNCTION_ID;
  const subscriptionsApiFunctionId = process.env.EXPO_PUBLIC_APPWRITE_SUBSCRIPTIONS_API_FUNCTION_ID;
  const aiVoiceFunctionId = process.env.EXPO_PUBLIC_APPWRITE_AI_VOICE_FUNCTION_ID;
  const userDataMigrationFunctionId =
    process.env.EXPO_PUBLIC_APPWRITE_USER_DATA_MIGRATION_FUNCTION_ID;
  const fcmProviderId = process.env.EXPO_PUBLIC_APPWRITE_FCM_PROVIDER_ID;

  const convexDelegate = convexUrl ? new ConvexBackendClient(convexUrl) : null;

  if (appwriteEndpoint && appwriteProjectId) {
    const awClient = createAppwriteClient(appwriteEndpoint, appwriteProjectId);
    _client = new AppwriteBackendClient(
      new Account(awClient),
      convexDelegate ?? undefined,
      new Databases(awClient),
      new Functions(awClient),
      notesSyncFunctionId,
      remindersApiFunctionId,
      subscriptionsApiFunctionId,
      aiVoiceFunctionId,
      userDataMigrationFunctionId,
      fcmProviderId,
    );
    return _client;
  }

  if (convexDelegate) {
    _client = convexDelegate;
    return _client;
  }

  return null;
};
