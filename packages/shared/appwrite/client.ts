import { Client } from 'appwrite';

/**
 * Creates and configures an Appwrite Client.
 *
 * The caller is responsible for resolving env vars and passing them in.
 * This keeps the shared package free of environment-specific import.meta / process.env
 * references that differ between mobile (EXPO_PUBLIC_*) and web (VITE_*).
 *
 * Mobile usage:
 *   createAppwriteClient(process.env.EXPO_PUBLIC_APPWRITE_ENDPOINT, process.env.EXPO_PUBLIC_APPWRITE_PROJECT_ID)
 *
 * Web usage:
 *   createAppwriteClient(import.meta.env.VITE_APPWRITE_ENDPOINT, import.meta.env.VITE_APPWRITE_PROJECT_ID)
 *
 * Call this once at app startup and share the instance (e.g. via React Context).
 */
export function createAppwriteClient(endpoint: string, projectId: string): Client {
  if (!endpoint) {
    throw new Error(
      'Appwrite endpoint not configured. Pass EXPO_PUBLIC_APPWRITE_ENDPOINT (mobile) or VITE_APPWRITE_ENDPOINT (web).',
    );
  }
  if (!projectId) {
    throw new Error(
      'Appwrite project ID not configured. Pass EXPO_PUBLIC_APPWRITE_PROJECT_ID (mobile) or VITE_APPWRITE_PROJECT_ID (web).',
    );
  }

  const client = new Client();
  client.setEndpoint(endpoint).setProject(projectId);
  return client;
}
