import { Client, Databases, Functions, ID, Query } from 'node-appwrite';
import { computeNextReminderAt } from './utils/billing.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATABASE_ID = 'ai-note-keeper';
const SUBSCRIPTIONS_COLLECTION = 'subscriptions';

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

// ---------------------------------------------------------------------------
// Serialization helpers
// reminderDaysBefore is stored as a JSON string (varchar 200) in Appwrite
// ---------------------------------------------------------------------------

function serializeReminderDays(value: number[]): string {
  return JSON.stringify(value);
}

function deserializeReminderDays(value: string | null | undefined): number[] {
  if (!value) return [];
  try {
    return JSON.parse(value) as number[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Doc mapper
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDocToSubscription(doc: Record<string, any>) {
  return {
    id: doc.$id as string,
    userId: doc.userId as string,
    serviceName: doc.serviceName as string,
    category: (doc.category ?? '') as string,
    price: doc.price as number,
    currency: doc.currency as string,
    billingCycle: doc.billingCycle as string,
    billingCycleCustomDays: (doc.billingCycleCustomDays ?? undefined) as number | undefined,
    nextBillingDate: doc.nextBillingDate as number,
    trialEndDate: (doc.trialEndDate ?? undefined) as number | undefined,
    status: doc.status as string,
    reminderDaysBefore: deserializeReminderDays(doc.reminderDaysBefore as string | null),
    nextReminderAt: (doc.nextReminderAt ?? undefined) as number | undefined,
    lastNotifiedBillingDate: (doc.lastNotifiedBillingDate ?? undefined) as number | undefined,
    nextTrialReminderAt: (doc.nextTrialReminderAt ?? undefined) as number | undefined,
    lastNotifiedTrialEndDate: (doc.lastNotifiedTrialEndDate ?? undefined) as number | undefined,
    notes: (doc.notes ?? undefined) as string | undefined,
    active: Boolean(doc.active),
    deletedAt: (doc.deletedAt ?? undefined) as number | undefined,
    createdAt: doc.createdAt as number,
    updatedAt: doc.updatedAt as number,
  };
}

// ---------------------------------------------------------------------------
// Path helpers
// Paths are prefixed with /subscriptions, e.g. /subscriptions, /subscriptions/:id
// ---------------------------------------------------------------------------

function extractSubPath(path: string): string {
  const PREFIX = '/subscriptions';
  if (path.startsWith(PREFIX)) {
    return path.slice(PREFIX.length) || '/';
  }
  return path;
}

function extractSeg1(subPath: string): string | null {
  const parts = subPath.replace(/^\//, '').split('/');
  return parts[0] || null;
}

function extractSeg2(subPath: string): string | null {
  const parts = subPath.replace(/^\//, '').split('/');
  return parts[1] || null;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export default async function main(context: AppwriteContext): Promise<void> {
  const { req, res, log, error } = context;

  // Auth: Appwrite runtime injects x-appwrite-user-id from the verified session
  const userId = req.headers['x-appwrite-user-id'];
  if (!userId) {
    return res.json({ error: 'Unauthorized', status: 401 }, 401);
  }

  const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT;
  const apiKey = process.env.APPWRITE_FUNCTION_API_KEY;
  const projectId = process.env.APPWRITE_FUNCTION_PROJECT_ID;

  if (!endpoint || !apiKey || !projectId) {
    error(
      'Missing APPWRITE_FUNCTION_API_ENDPOINT, APPWRITE_FUNCTION_PROJECT_ID, or APPWRITE_FUNCTION_API_KEY',
    );
    return res.json({ error: 'Internal server error', status: 500 }, 500);
  }

  const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  const databases = new Databases(client);
  const functions = new Functions(client);
  const pushFunctionId = process.env.PUSH_FUNCTION_ID;

  const { method, path } = req;
  const subPath = extractSubPath(path);
  const seg1 = extractSeg1(subPath);
  const seg2 = extractSeg2(subPath);

  // ---------------------------------------------------------------------------
  // GET /subscriptions — listSubscriptions (active=true)
  // ---------------------------------------------------------------------------
  if (method === 'GET' && !seg1) {
    const queryUserId = req.query['userId'] ?? userId;
    if (queryUserId !== userId) {
      return res.json({ error: 'Forbidden', status: 403 }, 403);
    }
    try {
      const result = await databases.listDocuments(DATABASE_ID, SUBSCRIPTIONS_COLLECTION, [
        Query.equal('userId', userId),
        Query.equal('active', true),
      ]);
      return res.json(result.documents.map(mapDocToSubscription));
    } catch (err) {
      error(`listSubscriptions failed: ${String(err)}`);
      return res.json({ error: 'Failed to list subscriptions', status: 500 }, 500);
    }
  }

  // ---------------------------------------------------------------------------
  // GET /subscriptions/deleted — listDeletedSubscriptions (active=false)
  // ---------------------------------------------------------------------------
  if (method === 'GET' && seg1 === 'deleted') {
    const queryUserId = req.query['userId'] ?? userId;
    if (queryUserId !== userId) {
      return res.json({ error: 'Forbidden', status: 403 }, 403);
    }
    try {
      const result = await databases.listDocuments(DATABASE_ID, SUBSCRIPTIONS_COLLECTION, [
        Query.equal('userId', userId),
        Query.equal('active', false),
      ]);
      const sorted = [...result.documents].sort(
        (a, b) =>
          ((b.deletedAt ?? b.updatedAt) as number) - ((a.deletedAt ?? a.updatedAt) as number),
      );
      return res.json(sorted.map(mapDocToSubscription));
    } catch (err) {
      error(`listDeletedSubscriptions failed: ${String(err)}`);
      return res.json({ error: 'Failed to list deleted subscriptions', status: 500 }, 500);
    }
  }

  // ---------------------------------------------------------------------------
  // DELETE /subscriptions/trash — emptySubscriptionTrash
  // ---------------------------------------------------------------------------
  if (method === 'DELETE' && seg1 === 'trash' && !seg2) {
    const queryUserId = req.query['userId'] ?? userId;
    if (queryUserId !== userId) {
      return res.json({ error: 'Forbidden', status: 403 }, 403);
    }
    try {
      const result = await databases.listDocuments(DATABASE_ID, SUBSCRIPTIONS_COLLECTION, [
        Query.equal('userId', userId),
        Query.equal('active', false),
      ]);
      await Promise.all(
        result.documents.map((doc) =>
          databases.deleteDocument(DATABASE_ID, SUBSCRIPTIONS_COLLECTION, doc.$id as string),
        ),
      );
      log(`Emptied trash for user ${userId}: ${result.documents.length} subscriptions deleted`);
      return res.json({ deleted: result.documents.length });
    } catch (err) {
      error(`emptySubscriptionTrash failed: ${String(err)}`);
      return res.json({ error: 'Failed to empty subscription trash', status: 500 }, 500);
    }
  }

  // ---------------------------------------------------------------------------
  // POST /subscriptions — createSubscription
  // ---------------------------------------------------------------------------
  if (method === 'POST' && !seg1) {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return res.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    const bodyUserId = body['userId'] as string | undefined;
    if (!bodyUserId) {
      return res.json({ error: 'Missing userId in body', status: 400 }, 400);
    }
    if (bodyUserId !== userId) {
      return res.json({ error: 'Forbidden', status: 403 }, 403);
    }

    const now = Date.now();
    const reminderDaysBefore = (body['reminderDaysBefore'] as number[] | undefined) ?? [];
    const nextBillingDate = body['nextBillingDate'] as number;
    const trialEndDate = body['trialEndDate'] as number | undefined;
    const nextReminderAt = computeNextReminderAt(nextBillingDate, reminderDaysBefore) ?? undefined;
    const nextTrialReminderAt = trialEndDate
      ? (computeNextReminderAt(trialEndDate, reminderDaysBefore) ?? undefined)
      : undefined;

    const docFields: Record<string, unknown> = {
      userId: bodyUserId,
      serviceName: body['serviceName'] as string,
      category: (body['category'] as string | undefined) ?? '',
      price: body['price'] as number,
      currency: body['currency'] as string,
      billingCycle: body['billingCycle'] as string,
      nextBillingDate,
      notes: (body['notes'] as string | undefined) ?? null,
      status: (body['status'] as string | undefined) ?? 'active',
      reminderDaysBefore: serializeReminderDays(reminderDaysBefore),
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    if (body['billingCycleCustomDays'] !== undefined) {
      docFields['billingCycleCustomDays'] = body['billingCycleCustomDays'];
    }
    if (trialEndDate !== undefined) {
      docFields['trialEndDate'] = trialEndDate;
    }
    if (nextReminderAt !== undefined) {
      docFields['nextReminderAt'] = nextReminderAt;
    }
    if (nextTrialReminderAt !== undefined) {
      docFields['nextTrialReminderAt'] = nextTrialReminderAt;
    }

    try {
      const created = await databases.createDocument(
        DATABASE_ID,
        SUBSCRIPTIONS_COLLECTION,
        ID.unique(),
        docFields,
      );
      log(`Created subscription ${created.$id as string}`);
      await firePushAsync(functions, pushFunctionId, {
        type: 'subscription',
        userId,
        subscriptionId: created.$id as string,
        title: (docFields['serviceName'] as string) ?? '',
        body: '',
        reminderKind: 'sync',
      });
      return res.json({ id: created.$id as string }, 201);
    } catch (err) {
      error(`createSubscription failed: ${String(err)}`);
      return res.json({ error: 'Failed to create subscription', status: 500 }, 500);
    }
  }

  // ---------------------------------------------------------------------------
  // PATCH /subscriptions/:id — updateSubscription
  // ---------------------------------------------------------------------------
  if (method === 'PATCH' && seg1 && !seg2) {
    const subscriptionId = seg1;
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return res.json({ error: 'Invalid JSON body', status: 400 }, 400);
    }

    try {
      const existing = await databases.listDocuments(DATABASE_ID, SUBSCRIPTIONS_COLLECTION, [
        Query.equal('$id', subscriptionId),
        Query.equal('userId', userId),
      ]);
      const doc = existing.documents[0];
      if (!doc) {
        return res.json({ error: 'Subscription not found', status: 404 }, 404);
      }

      const nextBillingDate =
        (body['nextBillingDate'] as number | undefined) ?? (doc.nextBillingDate as number);
      const reminderDaysBefore =
        (body['reminderDaysBefore'] as number[] | undefined) ??
        deserializeReminderDays(doc.reminderDaysBefore as string | null);
      const trialEndDate =
        'trialEndDate' in body
          ? (body['trialEndDate'] as number | undefined)
          : (doc.trialEndDate as number | undefined);

      const nextReminderAt = computeNextReminderAt(nextBillingDate, reminderDaysBefore);
      const nextTrialReminderAt = trialEndDate
        ? computeNextReminderAt(trialEndDate, reminderDaysBefore)
        : null;

      const patch: Record<string, unknown> = {
        updatedAt: Date.now(),
        nextReminderAt: nextReminderAt ?? null,
        nextTrialReminderAt: nextTrialReminderAt ?? null,
      };

      const fieldsToCopy = [
        'serviceName',
        'category',
        'price',
        'currency',
        'billingCycle',
        'billingCycleCustomDays',
        'nextBillingDate',
        'trialEndDate',
        'notes',
        'status',
      ];
      for (const field of fieldsToCopy) {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          patch[field] = body[field];
        }
      }
      if (Object.prototype.hasOwnProperty.call(body, 'reminderDaysBefore')) {
        patch['reminderDaysBefore'] = serializeReminderDays(body['reminderDaysBefore'] as number[]);
      }

      const updated = await databases.updateDocument(
        DATABASE_ID,
        SUBSCRIPTIONS_COLLECTION,
        subscriptionId,
        patch,
      );
      await firePushAsync(functions, pushFunctionId, {
        type: 'subscription',
        userId,
        subscriptionId,
        title: (patch['serviceName'] as string | undefined) ?? (doc.serviceName as string) ?? '',
        body: '',
        reminderKind: 'sync',
      });
      return res.json(mapDocToSubscription(updated));
    } catch (err) {
      error(`updateSubscription failed: ${String(err)}`);
      return res.json({ error: 'Failed to update subscription', status: 500 }, 500);
    }
  }

  // ---------------------------------------------------------------------------
  // DELETE /subscriptions/:id — deleteSubscription (soft delete)
  // ---------------------------------------------------------------------------
  if (method === 'DELETE' && seg1 && seg1 !== 'trash' && !seg2) {
    const subscriptionId = seg1;
    try {
      const existing = await databases.listDocuments(DATABASE_ID, SUBSCRIPTIONS_COLLECTION, [
        Query.equal('$id', subscriptionId),
        Query.equal('userId', userId),
      ]);
      const doc = existing.documents[0];
      if (!doc) {
        return res.json({ error: 'Subscription not found', status: 404 }, 404);
      }

      const now = Date.now();
      await databases.updateDocument(DATABASE_ID, SUBSCRIPTIONS_COLLECTION, subscriptionId, {
        active: false,
        deletedAt: now,
        updatedAt: now,
      });
      log(`Soft-deleted subscription ${subscriptionId}`);
      await firePushAsync(functions, pushFunctionId, {
        type: 'subscription',
        userId,
        subscriptionId,
        title: doc.serviceName as string,
        body: '',
        reminderKind: 'sync',
      });
      return res.json({ id: subscriptionId });
    } catch (err) {
      error(`deleteSubscription failed: ${String(err)}`);
      return res.json({ error: 'Failed to delete subscription', status: 500 }, 500);
    }
  }

  // ---------------------------------------------------------------------------
  // POST /subscriptions/:id/restore — restoreSubscription
  // ---------------------------------------------------------------------------
  if (method === 'POST' && seg1 && seg2 === 'restore') {
    const subscriptionId = seg1;
    try {
      const existing = await databases.listDocuments(DATABASE_ID, SUBSCRIPTIONS_COLLECTION, [
        Query.equal('$id', subscriptionId),
        Query.equal('userId', userId),
      ]);
      const doc = existing.documents[0];
      if (!doc) {
        return res.json({ error: 'Subscription not found', status: 404 }, 404);
      }

      const updated = await databases.updateDocument(
        DATABASE_ID,
        SUBSCRIPTIONS_COLLECTION,
        subscriptionId,
        { active: true, deletedAt: null, updatedAt: Date.now() },
      );
      log(`Restored subscription ${subscriptionId}`);
      await firePushAsync(functions, pushFunctionId, {
        type: 'subscription',
        userId,
        subscriptionId,
        title: doc.serviceName as string,
        body: '',
        reminderKind: 'sync',
      });
      return res.json(mapDocToSubscription(updated));
    } catch (err) {
      error(`restoreSubscription failed: ${String(err)}`);
      return res.json({ error: 'Failed to restore subscription', status: 500 }, 500);
    }
  }

  // ---------------------------------------------------------------------------
  // POST /subscriptions/:id/permanent-delete — permanentlyDeleteSubscription
  // ---------------------------------------------------------------------------
  if (method === 'POST' && seg1 && seg2 === 'permanent-delete') {
    const subscriptionId = seg1;
    try {
      const existing = await databases.listDocuments(DATABASE_ID, SUBSCRIPTIONS_COLLECTION, [
        Query.equal('$id', subscriptionId),
        Query.equal('userId', userId),
      ]);
      const doc = existing.documents[0];
      if (!doc) {
        return res.json({ error: 'Subscription not found', status: 404 }, 404);
      }
      if (doc.active !== false) {
        return res.json(
          { error: 'Cannot permanently delete an active subscription', status: 400 },
          400,
        );
      }
      await databases.deleteDocument(DATABASE_ID, SUBSCRIPTIONS_COLLECTION, subscriptionId);
      log(`Permanently deleted subscription ${subscriptionId}`);
      return res.json({ id: subscriptionId });
    } catch (err) {
      error(`permanentlyDeleteSubscription failed: ${String(err)}`);
      return res.json({ error: 'Failed to permanently delete subscription', status: 500 }, 500);
    }
  }

  return res.json({ error: 'Not found', status: 404 }, 404);
}

// ---------------------------------------------------------------------------
// Helper — fire push notification asynchronously (non-blocking)
// ---------------------------------------------------------------------------

async function firePushAsync(
  functions: Functions,
  pushFunctionId: string | undefined,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!pushFunctionId) return;
  try {
    await functions.createExecution(pushFunctionId, JSON.stringify(payload), true);
  } catch {
    // Best-effort — push failure must not fail the mutation
  }
}
