import { Client, Databases, Functions, Query, Users } from 'node-appwrite';
import { createSign } from 'crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATABASE_ID = 'ai-note-keeper';
const NOTES_COLLECTION = 'notes';
const MAX_PUSH_RETRIES = 2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AppwriteRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  query: Record<string, string>;
}

interface AppwriteResponse {
  json(data: unknown, statusCode?: number): void;
}

interface AppwriteContext {
  req: AppwriteRequest;
  res: AppwriteResponse;
  log: (msg: string) => void;
  error: (msg: string) => void;
}

interface FirebaseServiceAccount {
  project_id: string;
  private_key: string;
  client_email: string;
}

type FcmErrorBody = {
  error?: {
    status?: string;
    details?: Array<{ errorCode?: string }>;
  };
};

// ---------------------------------------------------------------------------
// Checklist content helper — mirrors packages/shared/utils/checklist.ts
// Inlined to avoid cross-package import in a standalone Appwrite function.
// ---------------------------------------------------------------------------

function checklistToPlainText(raw: string): string {
  try {
    const items = JSON.parse(raw) as Array<{ text: string; checked: boolean }>;
    if (!Array.isArray(items)) return raw;
    return items.map((item) => `${item.checked ? '✓' : '☐'} ${item.text}`).join('\n');
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// FCM helpers — ported from convex/functions/push.ts
// ---------------------------------------------------------------------------

function isUnregisteredResponse(status: number, body: string): boolean {
  if (status !== 404) return false;
  try {
    const parsed = JSON.parse(body) as FcmErrorBody;
    return parsed.error?.details?.[0]?.errorCode === 'UNREGISTERED';
  } catch {
    return false;
  }
}

async function getAccessToken(serviceAccount: FirebaseServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim = Buffer.from(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    }),
  ).toString('base64url');

  const signatureInput = `${header}.${claim}`;
  const sign = createSign('RSA-SHA256');
  sign.update(signatureInput);
  sign.end();
  const signature = sign.sign(serviceAccount.private_key, 'base64url');
  const jwt = `${signatureInput}.${signature}`;

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    throw new Error(`Failed to get FCM access token: ${errorText}`);
  }

  const data = (await tokenResponse.json()) as { access_token: string };
  return data.access_token;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export default async function main(context: AppwriteContext): Promise<void> {
  const { req, res, log, error } = context;

  const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT;
  const apiKey = process.env.APPWRITE_FUNCTION_API_KEY;
  const projectId = process.env.APPWRITE_FUNCTION_PROJECT_ID;
  const pushFunctionId = process.env.PUSH_FUNCTION_ID;

  if (!endpoint || !apiKey || !projectId) {
    error(
      'Missing APPWRITE_FUNCTION_API_ENDPOINT, APPWRITE_FUNCTION_PROJECT_ID, or APPWRITE_FUNCTION_API_KEY',
    );
    return res.json({ error: 'Internal server error' }, 500);
  }

  const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  const databases = new Databases(client);
  const functions = new Functions(client);
  const users = new Users(client);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(req.body || '{}') as Record<string, unknown>;
  } catch {
    return res.json({ error: 'Invalid JSON body' }, 400);
  }

  const type = body['type'] as string | undefined;

  if (type === 'reminder') {
    await handleReminderPush({
      body,
      databases,
      users,
      functions,
      pushFunctionId,
      log,
      error,
      projectId,
    });
    return res.json({ ok: true });
  }

  if (type === 'subscription') {
    await handleSubscriptionPush({ body, users, log, error, projectId });
    return res.json({ ok: true });
  }

  return res.json({ error: 'Unknown type' }, 400);
}

// ---------------------------------------------------------------------------
// Reminder push — ported from convex/functions/push.ts sendPush
// ---------------------------------------------------------------------------

interface ReminderPushArgs {
  body: Record<string, unknown>;
  databases: Databases;
  users: Users;
  functions: Functions;
  pushFunctionId: string | undefined;
  log: (msg: string) => void;
  error: (msg: string) => void;
  projectId: string;
}

async function handleReminderPush({
  body,
  databases,
  users,
  functions,
  pushFunctionId,
  log,
  error,
  projectId,
}: ReminderPushArgs): Promise<void> {
  const userId = body['userId'] as string | undefined;
  const reminderId = body['reminderId'] as string | undefined;
  const changeEventId = body['changeEventId'] as string | undefined;
  const excludeDeviceId = body['excludeDeviceId'] as string | undefined;
  const isTrigger = Boolean(body['isTrigger'] ?? false);
  const retryCount = (body['retryCount'] as number | undefined) ?? 0;

  if (!userId || !reminderId || !changeEventId) {
    error('[Push] Missing userId, reminderId, or changeEventId');
    return;
  }

  log(`[Push] Reminder push for ${reminderId}, user ${userId}`);

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  const firebaseProjectId = process.env.FIREBASE_PROJECT_ID;
  if (!serviceAccountJson || !firebaseProjectId) {
    error('[Push] FIREBASE_SERVICE_ACCOUNT or FIREBASE_PROJECT_ID not set');
    return;
  }

  // Fetch device push targets from Appwrite native push targets
  const targetsResult = await users.listTargets(userId, [Query.equal('providerType', 'push')]);
  const targets = targetsResult.targets.filter((t) => t.$id !== excludeDeviceId);
  if (targets.length === 0) {
    log(`[Push] No target devices for user ${userId}`);
    return;
  }

  // Fetch note for title/body
  let title = 'Reminder';
  let noteBody = '';
  try {
    const noteResult = await databases.listDocuments(DATABASE_ID, NOTES_COLLECTION, [
      Query.equal('$id', reminderId),
    ]);
    const note = noteResult.documents[0];
    if (note) {
      const noteTitle = ((note['title'] as string | undefined) ?? '').trim();
      const rawContent = ((note['content'] as string | undefined) ?? '').trim();
      const contentType = (note['contentType'] as string | undefined) ?? 'text';
      const resolvedContent =
        contentType === 'checklist' ? checklistToPlainText(rawContent) : rawContent;
      title = noteTitle || resolvedContent || 'Reminder';
      noteBody = noteTitle && resolvedContent ? resolvedContent : '';
    }
  } catch (err) {
    error(`[Push] Failed to fetch note ${reminderId}: ${String(err)}`);
  }

  const serviceAccount = JSON.parse(serviceAccountJson) as FirebaseServiceAccount;
  let accessToken: string;
  try {
    accessToken = await getAccessToken(serviceAccount);
  } catch (err) {
    error(`[Push] Failed to get FCM access token: ${String(err)}`);
    return;
  }

  const messageType = isTrigger ? 'trigger_reminder' : 'sync_reminder';

  await Promise.all(
    targets.map(async (target) => {
      const fcmToken = target.identifier;
      const deviceId = target.$id;

      try {
        const fcmRes = await fetch(
          `https://fcm.googleapis.com/v1/projects/${firebaseProjectId}/messages:send`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              message: {
                token: fcmToken,
                data: {
                  type: messageType,
                  id: reminderId,
                  eventId: changeEventId,
                  title,
                  body: noteBody,
                },
                android: { priority: 'high' },
              },
            }),
          },
        );

        const responseBody = await fcmRes.text();

        if (!fcmRes.ok) {
          error(`[Push] FCM failed for ${deviceId}: ${responseBody}`);

          if (isUnregisteredResponse(fcmRes.status, responseBody)) {
            await users.deleteTarget(userId, deviceId);
            log(`[Push] Removed unregistered target for ${deviceId}`);
          } else if (
            (fcmRes.status === 429 || fcmRes.status >= 500) &&
            retryCount < MAX_PUSH_RETRIES &&
            pushFunctionId
          ) {
            // Self-reinvocation retry — no delay available in Appwrite (degrades vs Convex 30s backoff)
            log(
              `[Push] Transient error (${fcmRes.status}), scheduling retry ${retryCount + 1}/${MAX_PUSH_RETRIES}`,
            );
            await functions.createExecution(
              pushFunctionId,
              JSON.stringify({
                type: 'reminder',
                userId,
                reminderId,
                changeEventId,
                excludeDeviceId,
                isTrigger,
                retryCount: retryCount + 1,
              }),
              true, // async
            );
          }
          return;
        }

        log(`[Push] FCM success for ${deviceId}`);
      } catch (err) {
        error(`[Push] Error sending to ${deviceId}: ${String(err)}`);
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Subscription push — ported from convex/functions/push.ts sendSubscriptionPush
// ---------------------------------------------------------------------------

interface SubscriptionPushArgs {
  body: Record<string, unknown>;
  users: Users;
  log: (msg: string) => void;
  error: (msg: string) => void;
  projectId: string;
}

async function handleSubscriptionPush({
  body,
  users,
  log,
  error,
}: SubscriptionPushArgs): Promise<void> {
  const userId = body['userId'] as string | undefined;
  const subscriptionId = body['subscriptionId'] as string | undefined;
  const title = (body['title'] as string | undefined) ?? '';
  const noteBody = (body['body'] as string | undefined) ?? '';
  const reminderKind = (body['reminderKind'] as string | undefined) ?? 'billing';

  if (!userId || !subscriptionId) {
    error('[Push] Missing userId or subscriptionId');
    return;
  }

  log(`[Push] Subscription push (${reminderKind}) for ${subscriptionId}, user ${userId}`);

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  const firebaseProjectId = process.env.FIREBASE_PROJECT_ID;
  if (!serviceAccountJson || !firebaseProjectId) {
    error('[Push] FIREBASE_SERVICE_ACCOUNT or FIREBASE_PROJECT_ID not set');
    return;
  }

  const tokensResult = await users.listTargets(userId, [Query.equal('providerType', 'push')]);

  if (tokensResult.targets.length === 0) {
    log(`[Push] No tokens for user ${userId}`);
    return;
  }

  const serviceAccount = JSON.parse(serviceAccountJson) as FirebaseServiceAccount;
  let accessToken: string;
  try {
    accessToken = await getAccessToken(serviceAccount);
  } catch (err) {
    error(`[Push] Failed to get FCM access token: ${String(err)}`);
    return;
  }

  await Promise.all(
    tokensResult.targets.map(async (target) => {
      const fcmToken = target.identifier;
      const deviceId = target.$id;

      try {
        const fcmRes = await fetch(
          `https://fcm.googleapis.com/v1/projects/${firebaseProjectId}/messages:send`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              message: {
                token: fcmToken,
                data: {
                  type: 'subscription_reminder',
                  reminderKind,
                  id: subscriptionId,
                  title,
                  body: noteBody,
                },
                android: { priority: 'high' },
              },
            }),
          },
        );

        const responseBody = await fcmRes.text();
        if (!fcmRes.ok) {
          error(`[Push] FCM failed for ${deviceId}: ${responseBody}`);
          if (isUnregisteredResponse(fcmRes.status, responseBody)) {
            await users.deleteTarget(userId, deviceId);
            log(`[Push] Removed unregistered target for ${deviceId}`);
          }
          return;
        }

        log(`[Push] FCM success for ${deviceId}`);
      } catch (err) {
        error(`[Push] Error sending to ${deviceId}: ${String(err)}`);
      }
    }),
  );
}
