import { Account, AppwriteException, ID, Models } from 'appwrite';
import type { UserRecord } from '../backend/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function toSyntheticEmail(username: string): string {
  return `${username}@app.notekeeper.local`;
}

export function usernameFromUser(user: Models.User<Models.Preferences>): string {
  return user.name;
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

/**
 * Ensures an anonymous Appwrite session exists.
 * - If a session is already active, refreshes it and returns the existing $id.
 * - Otherwise, creates a new anonymous session and returns its $id.
 */
export async function getOrCreateAnonymousSession(account: Account): Promise<string> {
  try {
    const user = await account.get();
    // Refresh the session expiry
    try {
      await account.updateSession('current');
    } catch {
      // Non-fatal — session refresh failure should not block identity resolution
    }
    return user.$id;
  } catch {
    // createAnonymousSession returns a Session object; userId is on session.userId
    const session = await account.createAnonymousSession();
    return session.userId;
  }
}

// ---------------------------------------------------------------------------
// Credential auth
// ---------------------------------------------------------------------------

/**
 * Creates a new Appwrite account with synthetic email, then starts a session.
 */
export async function registerUser(
  account: Account,
  username: string,
  password: string,
): Promise<UserRecord> {
  const email = toSyntheticEmail(username);
  await account.create(ID.unique(), email, password, username);
  await account.createEmailPasswordSession(email, password);
  const user = await account.get();
  return { userId: user.$id, username: user.name };
}

/**
 * Signs in with username + password using the synthetic email scheme.
 */
export async function loginUser(
  account: Account,
  username: string,
  password: string,
): Promise<UserRecord> {
  const email = toSyntheticEmail(username);
  await account.createEmailPasswordSession(email, password);
  const user = await account.get();
  return { userId: user.$id, username: user.name };
}

/**
 * Validates the current Appwrite session against a stored userId.
 * Returns UserRecord if session is active and userId matches; null otherwise.
 * Swallows AppwriteException (e.g. session expired) to allow offline fallback.
 */
export async function validateCurrentSession(
  account: Account,
  userId: string,
): Promise<UserRecord | null> {
  try {
    const user = await account.get();
    if (user.$id !== userId) {
      return null;
    }
    return { userId: user.$id, username: user.name };
  } catch (err) {
    if (err instanceof AppwriteException) {
      return null;
    }
    throw err;
  }
}

/**
 * Destroys all Appwrite sessions for the current user (full logout).
 */
export async function logoutUser(account: Account): Promise<void> {
  await account.deleteSessions();
}
