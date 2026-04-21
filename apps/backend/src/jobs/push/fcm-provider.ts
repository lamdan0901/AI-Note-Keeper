import { importPKCS8, SignJWT } from 'jose';

import type { PushDeliveryRequest, PushProvider, PushProviderResponse } from './contracts.js';

type FirebaseServiceAccount = Readonly<{
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}>;

type GoogleOAuthTokenResponse = Readonly<{
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}>;

type FcmV1ErrorDetail = Readonly<{
  '@type'?: string;
  errorCode?: string;
}>;

type FcmV1ErrorPayload = Readonly<{
  error?: Readonly<{
    code?: number;
    message?: string;
    status?: string;
    details?: ReadonlyArray<FcmV1ErrorDetail>;
  }>;
}>;

const FCM_REQUEST_TIMEOUT_MS = 10_000;
const OAUTH_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const OAUTH_EXP_SKEW_MS = 60_000;

let cachedAccessToken: Readonly<{
  fingerprint: string;
  accessToken: string;
  expiresAtMs: number;
}> | null = null;

const toProviderFailure = (
  input: Readonly<{ statusCode?: number; errorCode?: string; message?: string }>,
): PushProviderResponse => {
  return {
    ok: false,
    statusCode: input.statusCode,
    errorCode: input.errorCode,
    message: input.message,
  };
};

const decodeBase64Json = (value: string): string => {
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return '';
  }
};

const parseServiceAccount = (): FirebaseServiceAccount | null => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!raw) {
    return null;
  }

  const candidates = [raw, decodeBase64Json(raw)];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      const parsed = JSON.parse(candidate) as Partial<FirebaseServiceAccount>;
      if (
        typeof parsed.project_id === 'string' &&
        typeof parsed.client_email === 'string' &&
        typeof parsed.private_key === 'string'
      ) {
        return {
          project_id: parsed.project_id,
          client_email: parsed.client_email,
          private_key: parsed.private_key.replace(/\\n/g, '\n'),
          token_uri:
            typeof parsed.token_uri === 'string' && parsed.token_uri.trim().length > 0
              ? parsed.token_uri
              : OAUTH_TOKEN_URI,
        };
      }
    } catch {
      // Try next decode candidate.
    }
  }

  return null;
};

const resolveProjectId = (serviceAccount: FirebaseServiceAccount): string | null => {
  const envProjectId = process.env.FIREBASE_PROJECT_ID?.trim();
  if (envProjectId) {
    return envProjectId;
  }

  return serviceAccount.project_id?.trim() || null;
};

const resolveErrorCode = (payload: FcmV1ErrorPayload): string | undefined => {
  const details = payload.error?.details;
  if (Array.isArray(details)) {
    for (const detail of details) {
      if (detail && typeof detail.errorCode === 'string' && detail.errorCode.length > 0) {
        return detail.errorCode;
      }
    }
  }

  return payload.error?.status;
};

const createServiceAccountFingerprint = (
  input: Readonly<{ projectId: string; serviceAccount: FirebaseServiceAccount }>,
): string => {
  return [
    input.projectId,
    input.serviceAccount.client_email,
    input.serviceAccount.private_key.slice(0, 32),
  ].join(':');
};

const encodeFormBody = (input: Readonly<Record<string, string>>): string => {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(input)) {
    params.set(key, value);
  }

  return params.toString();
};

const resolveAccessToken = async (
  input: Readonly<{ projectId: string; serviceAccount: FirebaseServiceAccount }>,
): Promise<
  | Readonly<{ ok: false; failure: PushProviderResponse }>
  | Readonly<{ ok: true; accessToken: string }>
> => {
  const fingerprint = createServiceAccountFingerprint(input);
  if (
    cachedAccessToken &&
    cachedAccessToken.fingerprint === fingerprint &&
    cachedAccessToken.expiresAtMs > Date.now() + OAUTH_EXP_SKEW_MS
  ) {
    return {
      ok: true,
      accessToken: cachedAccessToken.accessToken,
    };
  }

  let assertion: string;
  try {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const privateKey = await importPKCS8(input.serviceAccount.private_key, 'RS256');
    assertion = await new SignJWT({ scope: FCM_SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(input.serviceAccount.client_email)
      .setSubject(input.serviceAccount.client_email)
      .setAudience(input.serviceAccount.token_uri ?? OAUTH_TOKEN_URI)
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + 3600)
      .sign(privateKey);
  } catch (error) {
    return {
      ok: false,
      failure: toProviderFailure({
        statusCode: 400,
        errorCode: 'FIREBASE_SERVICE_ACCOUNT_INVALID',
        message: error instanceof Error ? error.message : String(error),
      }),
    };
  }

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(input.serviceAccount.token_uri ?? OAUTH_TOKEN_URI, {
      method: 'POST',
      signal: AbortSignal.timeout(FCM_REQUEST_TIMEOUT_MS),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: encodeFormBody({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
  } catch (error) {
    const isTimeout =
      error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
    return {
      ok: false,
      failure: toProviderFailure({
        statusCode: isTimeout ? 504 : 503,
        errorCode: isTimeout ? 'FCM_AUTH_TIMEOUT' : 'FCM_AUTH_NETWORK_ERROR',
        message: error instanceof Error ? error.message : String(error),
      }),
    };
  }

  let tokenPayload: GoogleOAuthTokenResponse | null = null;
  try {
    tokenPayload = (await tokenResponse.json()) as GoogleOAuthTokenResponse;
  } catch {
    tokenPayload = null;
  }

  if (!tokenResponse.ok) {
    const isTransient = tokenResponse.status === 429 || tokenResponse.status >= 500;
    const sanitizedMessage = [tokenPayload?.error, tokenPayload?.error_description]
      .filter((value) => typeof value === 'string' && value.length > 0)
      .join(': ');

    return {
      ok: false,
      failure: toProviderFailure({
        statusCode: isTransient
          ? tokenResponse.status === 429
            ? 429
            : Math.max(tokenResponse.status, 500)
          : tokenResponse.status,
        errorCode: isTransient ? 'FCM_AUTH_UNAVAILABLE' : 'FCM_AUTH_FAILED',
        message:
          sanitizedMessage.length > 0
            ? sanitizedMessage
            : `OAuth token request failed with ${tokenResponse.status}`,
      }),
    };
  }

  if (!tokenPayload?.access_token || !tokenPayload.expires_in) {
    return {
      ok: false,
      failure: toProviderFailure({
        statusCode: 502,
        errorCode: 'FCM_AUTH_FAILED',
        message: 'OAuth token response missing required fields',
      }),
    };
  }

  cachedAccessToken = {
    fingerprint,
    accessToken: tokenPayload.access_token,
    expiresAtMs: Date.now() + tokenPayload.expires_in * 1000,
  };

  return {
    ok: true,
    accessToken: tokenPayload.access_token,
  };
};

const buildPayload = (request: PushDeliveryRequest): Readonly<Record<string, unknown>> => {
  // Prefer the rendered note text threaded from the scanner. Fall back to
  // the historical placeholder only when the caller did not supply text
  // (e.g. a retry path that predates this field). FCM data values must be
  // strings, so coerce nullish values.
  const title = typeof request.title === 'string' && request.title.length > 0
    ? request.title
    : 'Reminder';
  const body = typeof request.body === 'string' ? request.body : 'You have a reminder';

  return {
    message: {
      token: request.token.fcmToken,
      data: {
        type: request.isTrigger ? 'trigger_reminder' : 'sync_reminder',
        id: request.reminderId,
        noteId: request.reminderId,
        reminderId: request.reminderId,
        eventId: request.changeEventId,
        title,
        body,
      },
      android: {
        priority: 'HIGH',
      },
    },
  };
};

export const createFcmPushProvider = (): PushProvider => {
  return {
    sendToToken: async (request) => {
      const serviceAccount = parseServiceAccount();
      if (!serviceAccount) {
        return toProviderFailure({
          statusCode: 400,
          errorCode: 'FIREBASE_SERVICE_ACCOUNT_MISSING',
          message: 'FIREBASE_SERVICE_ACCOUNT is not configured or invalid',
        });
      }

      const projectId = resolveProjectId(serviceAccount);
      if (!projectId) {
        return toProviderFailure({
          statusCode: 400,
          errorCode: 'FIREBASE_PROJECT_ID_MISSING',
          message: 'FIREBASE_PROJECT_ID is not configured',
        });
      }

      const tokenResolution = await resolveAccessToken({ projectId, serviceAccount });
      if (!tokenResolution.ok) {
        return tokenResolution.failure;
      }

      let response: Response;
      try {
        response = await fetch(
          `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
          {
            method: 'POST',
            signal: AbortSignal.timeout(FCM_REQUEST_TIMEOUT_MS),
            headers: {
              authorization: `Bearer ${tokenResolution.accessToken}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify(buildPayload(request)),
          },
        );
      } catch (error) {
        const isTimeout =
          error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

        return toProviderFailure({
          statusCode: isTimeout ? 504 : 503,
          errorCode: isTimeout ? 'FCM_TIMEOUT' : 'FCM_NETWORK_ERROR',
          message: error instanceof Error ? error.message : String(error),
        });
      }

      let payload: FcmV1ErrorPayload | null = null;
      try {
        payload = (await response.json()) as FcmV1ErrorPayload;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const statusCode = payload?.error?.code ?? response.status;
        const errorCode = resolveErrorCode(payload ?? {});
        if (errorCode === 'UNREGISTERED') {
          return toProviderFailure({
            statusCode: 404,
            errorCode: 'UNREGISTERED',
            message: payload?.error?.message,
          });
        }

        const transientStatuses = new Set(['RESOURCE_EXHAUSTED', 'UNAVAILABLE', 'INTERNAL']);
        const normalizedStatusCode =
          statusCode === 429
            ? 429
            : statusCode >= 500 || transientStatuses.has(errorCode ?? '')
              ? Math.max(statusCode, 500)
              : statusCode;

        return toProviderFailure({
          statusCode: normalizedStatusCode,
          errorCode: errorCode ?? 'FCM_HTTP_ERROR',
          message: payload?.error?.message ?? `FCM request failed with ${response.status}`,
        });
      }

      return {
        ok: true,
      };
    },
  };
};

export const resetFcmProviderAuthCacheForTests = (): void => {
  cachedAccessToken = null;
};
