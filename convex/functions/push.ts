'use node';
import { internalAction } from '../_generated/server';
import { v } from 'convex/values';
import { api } from '../_generated/api';
import { createSign } from 'crypto';

interface FirebaseServiceAccount {
  project_id: string;
  private_key: string;
  client_email: string;
  type?: string;
  private_key_id?: string;
  client_id?: string;
  auth_uri?: string;
  token_uri?: string;
  auth_provider_x509_cert_url?: string;
  client_x509_cert_url?: string;
  universe_domain?: string;
}

type FcmErrorBody = {
  error?: {
    status?: string;
    details?: Array<{ errorCode?: string }>;
  };
};

const isUnregisteredResponse = (status: number, body: string): boolean => {
  if (status !== 404) {
    return false;
  }
  try {
    const parsed = JSON.parse(body) as FcmErrorBody;
    const errorCode = parsed.error?.details?.[0]?.errorCode;
    return errorCode === 'UNREGISTERED';
  } catch {
    return false;
  }
};

/**
 * Get OAuth 2.0 access token for FCM v1 API
 * Uses service account credentials
 */
async function getAccessToken(serviceAccount: FirebaseServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const jwtHeader = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const jwtClaim = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const base64Header = Buffer.from(JSON.stringify(jwtHeader)).toString('base64url');
  const base64Claim = Buffer.from(JSON.stringify(jwtClaim)).toString('base64url');
  const signatureInput = `${base64Header}.${base64Claim}`;

  // Sign with private key
  const sign = createSign('RSA-SHA256');
  sign.update(signatureInput);
  sign.end();

  const signature = sign.sign(serviceAccount.private_key, 'base64url');
  const jwt = `${signatureInput}.${signature}`;

  // Exchange JWT for access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    throw new Error(`Failed to get access token: ${errorText}`);
  }

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

export const sendPush = internalAction({
  args: {
    userId: v.string(),
    excludeDeviceId: v.optional(v.string()),
    reminderId: v.string(),
    changeEventId: v.string(),
    isTrigger: v.optional(v.boolean()),
  },
  handler: async (ctx, { userId, excludeDeviceId, reminderId, changeEventId, isTrigger }) => {
    console.log(`[Push] Starting push for reminder ${reminderId}, user ${userId}`);

    // 1. Get tokens
    const tokens = await ctx.runQuery(api.functions.deviceTokens.getTokensByUser, { userId });

    if (!tokens || tokens.length === 0) {
      console.warn(`[Push] No tokens found for user ${userId}`);
      return;
    }

    console.log(`[Push] Found ${tokens.length} tokens for user ${userId}`);

    // 2. Filter out sender
    const targets = tokens.filter((t) => t.deviceId !== excludeDeviceId);

    if (targets.length === 0) {
      console.warn(`[Push] No target devices after filtering`);
      return;
    }

    // 3. Get Firebase credentials
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

    const projectId = process.env.FIREBASE_PROJECT_ID;
    console.log('🍅 projectId', projectId);

    if (!serviceAccountJson || !projectId) {
      console.error('[Push] FIREBASE_SERVICE_ACCOUNT or FIREBASE_PROJECT_ID not set');
      return;
    }

    const serviceAccount = JSON.parse(serviceAccountJson) as FirebaseServiceAccount;

    // 4. Get reminder details from notes table
    const note = await ctx.runQuery(api.functions.reminders.getReminder, {
      reminderId,
    });

    const title = note?.title || 'Reminder';
    const body = note?.content || note?.title || 'You have a reminder';

    console.log(`[Push] Notification: "${title}" - "${body}"`);

    // 5. Get access token
    let accessToken: string;
    try {
      accessToken = await getAccessToken(serviceAccount);
      console.log('[Push] Successfully obtained OAuth access token');
    } catch (error) {
      console.error('[Push] Failed to get access token:', error);
      return;
    }

    const messageType = isTrigger ? 'trigger_reminder' : 'sync_reminder';

    // 6. Send FCM v1 API requests
    const results = await Promise.all(
      targets.map(async (token) => {
        try {
          console.log(`[Push] Sending to ${token.deviceId}`);

          const dataPayload = {
            type: messageType,
            id: reminderId,
            eventId: changeEventId,
            title,
            body,
          };

          const messagePayload = {
            data: dataPayload,
            android: {
              priority: 'high',
            },
          };

          const res = await fetch(
            `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({
                message: {
                  token: token.fcmToken,
                  ...messagePayload,
                },
              }),
            },
          );

          const responseBody = await res.text();

          if (!res.ok) {
            console.error(`[Push] FCM failed for ${token.deviceId}:`, {
              status: res.status,
              body: responseBody,
            });
            if (isUnregisteredResponse(res.status, responseBody)) {
              await ctx.runMutation(api.functions.deviceTokens.deleteDevicePushToken, {
                deviceId: token.deviceId,
              });
              console.warn(`[Push] Removed unregistered token for ${token.deviceId}`);
            }
            return { deviceId: token.deviceId, success: false, error: responseBody };
          }

          console.log(`[Push] FCM success for ${token.deviceId}:`, responseBody);
          return { deviceId: token.deviceId, success: true };
        } catch (error) {
          console.error(`[Push] Error for ${token.deviceId}:`, error);
          return { deviceId: token.deviceId, success: false, error: String(error) };
        }
      }),
    );

    console.log(`[Push] Complete. Results:`, results);
  },
});
