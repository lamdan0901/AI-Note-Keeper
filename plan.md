Multi-User Auth Support Plan

Context
The app is currently single-user with a hardcoded userId = 'local-user'. The goal is to add optional username/password authentication for cross-device syncing. By default, each device operates anonymously with a device UUID as the userId. Login is only needed for syncing across devices. Existing local-user data must be migrated to the env-specified user (EXPO_PUBLIC_USER_ID).

Phase 1: Convex Backend (Schema + Auth Functions)
1.1 Add users table to schema
File: convex/schema.ts

ts
users: defineTable({
username: v.string(),
passwordHash: v.string(), // format: "salt_hex:hash_hex"
createdAt: v.number(),
updatedAt: v.number(),
}).index("by_username", ["username"])
1.2 Create auth functions
New file: convex/functions/auth.ts

register (mutation): Validate username (3-30 chars, alphanumeric+underscore), check uniqueness via index, hash password with SHA-256 + random salt, create user record. Return { userId, username }.
login (mutation): Look up by username, verify password hash. Return { userId, username } or throw error.
validateSession (query): Verify userId exists, return user info or null.
Password hashing: Use a JS SHA-256 implementation (add js-sha256 to convex deps) with per-user 16-byte hex salt. Convex runtime doesn't support bcrypt.

1.3 Create data migration function
New file: convex/functions/userDataMigration.ts

migrateUserData (mutation): Takes fromUserId, toUserId. Updates userId on all notes, subscriptions, devicePushTokens, noteChangeEvents records.
Phase 2: Mobile Auth Infrastructure
2.1 Auth storage
Use expo-secure-store (add to deps) for persisting auth session: { userId, username }.

2.2 Auth Context
New file: apps/mobile/src/auth/AuthContext.tsx

ts
type AuthState = {
isLoading: boolean;
isAuthenticated: boolean;
userId: string; // device UUID (anon) or Convex user \_id (authenticated)
username: string | null;
deviceId: string;
};
Behaviors:

On mount: Read session from SecureStore → validate with Convex → set state
No session: Use device UUID from AsyncStorage (DEVICE_UNIQUE_ID) as userId
Login: Persist session to SecureStore, merge anonymous data, trigger sync
Logout: Clear SecureStore, revert to device UUID
Export useAuth() hook
2.3 useUserId() hook
New file: apps/mobile/src/auth/useUserId.ts

Simple wrapper: const { userId } = useAuth(); return userId;

Phase 3: Auth Screens
3.1 Login Screen
New file: apps/mobile/src/screens/LoginScreen.tsx

Username + password inputs, Login button, "Create account" link, "Skip" button
Uses useAuth().login()
3.2 Register Screen
New file: apps/mobile/src/screens/RegisterScreen.tsx

Username + password + confirm password inputs, Register button, "Already have account?" link
Input validation (min lengths, password match)
Uses useAuth().register()
3.3 Navigation
Auth screens rendered as full-screen modals in AppContent (same opacity-toggle pattern). State: authScreen: 'login' | 'register' | null.

Phase 4: Wire Auth Into Existing Code
4.1 Update App.tsx
Wrap app with AuthProvider (above or beside ThemeProvider)
Pass userId from AuthContext into SyncProvider and screen components
Add auth screen modal rendering
4.2 Replace all hardcoded 'local-user' references
File Change
src/sync/syncManager.tsx:54 Remove default, require userId prop
src/sync/noteSync.ts:55 Remove default param
src/notes/editor.ts:14 Remove default param
src/sync/registerDeviceToken.ts:19 Use userId from AuthContext
src/subscriptions/service.ts:9 Accept userId parameter in hooks
src/notes/realtimeService.ts Accept userId parameter
src/screens/NotesScreen.tsx Use useUserId()
src/screens/TrashScreen.tsx Use useUserId()
src/reminders/headless.ts Read from SecureStore (no React context in headless)
src/reminders/scheduleNoteReminder.ts Accept userId parameter
For headless tasks, add helper:

ts
async function resolveCurrentUserId(): Promise<string> {
const session = await SecureStore.getItemAsync('AUTH_SESSION');
if (session) return JSON.parse(session).userId;
const deviceId = await AsyncStorage.getItem('DEVICE_UNIQUE_ID');
return deviceId || uuid.v4();
}
Phase 5: SQLite Migration
5.1 Migration 014 — add userId to notes
File: apps/mobile/src/db/migrations.ts

sql
ALTER TABLE notes ADD COLUMN userId TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_notes_userId ON notes (userId);
5.2 Backfill on startup
After migration runs, update all NULL userId rows with current userId.

Phase 6: Data Migration
6.1 Legacy local-user → env user (one-time)
On startup, if EXPO_PUBLIC_USER_ID is set and != 'local-user':

Call Convex migrateUserData('local-user', envUserId)
Update local SQLite: UPDATE notes SET userId = ? WHERE userId = 'local-user'
Update outbox similarly
Set AsyncStorage flag LEGACY_MIGRATION_DONE to prevent re-running
6.2 Anonymous → authenticated (on login)
When user logs in and device has anonymous data:

Call Convex migrateUserData(deviceUUID, authenticatedUserId)
Update local SQLite userId columns
Trigger full sync
6.3 Logout
Revert userId to device UUID
Keep local data (don't delete)
New notes use device UUID
On re-login, merge again
Phase 7: Settings Screen Update
File: apps/mobile/src/screens/SettingsScreen.tsx

Add "Account" section above "Theme":

Anonymous: "Local account" label + "Sign In" / "Create Account" buttons
Authenticated: "Signed in as {username}" + "Sign Out" button with confirmation
Verification
Fresh install: App starts with device UUID as userId, notes save locally
Register: Create account → userId switches to Convex ID → new notes sync
Login on same device: Anonymous notes merged to account
Login on new device: See synced notes from other device
Logout: Reverts to device UUID, local data preserved
Legacy migration: Start with EXPO_PUBLIC_USER_ID=someuser → local-user data migrates
Headless tasks: Reminders still fire with correct userId after login/logout
Files to Create
convex/functions/auth.ts
convex/functions/userDataMigration.ts
apps/mobile/src/auth/AuthContext.tsx
apps/mobile/src/auth/useUserId.ts
apps/mobile/src/screens/LoginScreen.tsx
apps/mobile/src/screens/RegisterScreen.tsx
Files to Modify
convex/schema.ts — add users table
apps/mobile/App.tsx — AuthProvider + auth screen modals
apps/mobile/src/db/migrations.ts — migration 014
apps/mobile/src/screens/SettingsScreen.tsx — account section
apps/mobile/src/sync/syncManager.tsx — dynamic userId
apps/mobile/src/sync/noteSync.ts — remove default
apps/mobile/src/notes/editor.ts — remove default
apps/mobile/src/sync/registerDeviceToken.ts — use AuthContext
apps/mobile/src/subscriptions/service.ts — parameterize userId
apps/mobile/src/hooks/useNoteActions.ts — pass userId through
apps/mobile/src/reminders/headless.ts — SecureStore userId resolution
apps/mobile/src/screens/NotesScreen.tsx — useUserId()
apps/mobile/src/screens/TrashScreen.tsx — useUserId()
