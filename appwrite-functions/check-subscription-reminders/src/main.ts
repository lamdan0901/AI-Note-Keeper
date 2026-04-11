import { Client, Databases, Functions, Query } from 'node-appwrite';
import { computeNextReminderAt, computeAdvancedBillingDate } from './utils/billing.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATABASE_ID = 'ai-note-keeper';
const SUBSCRIPTIONS_COLLECTION = 'subscriptions';
const PAGE_LIMIT = 200;

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SubDoc = Record<string, any>;

// ---------------------------------------------------------------------------
// Main handler — ported from convex/functions/subscriptions.ts checkSubscriptionReminders
// ---------------------------------------------------------------------------

export default async function main(context: AppwriteContext): Promise<void> {
  const { res, log, error } = context;

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

  const now = Date.now();

  // -------------------------------------------------------------------------
  // Step 1 — Billing reminders
  // -------------------------------------------------------------------------
  const billingNotified = await processBillingReminders(
    databases,
    functions,
    pushFunctionId,
    now,
    log,
    error,
  );

  // -------------------------------------------------------------------------
  // Step 2 — Trial-end reminders
  // -------------------------------------------------------------------------
  const trialNotified = await processTrialReminders(
    databases,
    functions,
    pushFunctionId,
    now,
    log,
    error,
  );

  // -------------------------------------------------------------------------
  // Step 3 — Auto-advance overdue billing dates (no push)
  // -------------------------------------------------------------------------
  const billingAdvanced = await advanceOverdueBilling(databases, now, log, error);

  log(
    `[SubReminders] Done. Billing notifications: ${billingNotified}, Trial notifications: ${trialNotified}, Billing dates advanced: ${billingAdvanced}`,
  );
  return res.json({ billingNotified, trialNotified, billingAdvanced });
}

// ---------------------------------------------------------------------------
// Step 1: Billing reminders
// ---------------------------------------------------------------------------

async function processBillingReminders(
  databases: Databases,
  functions: Functions,
  pushFunctionId: string | undefined,
  now: number,
  log: (msg: string) => void,
  error: (msg: string) => void,
): Promise<number> {
  let notified = 0;

  let dueSubs: SubDoc[];
  try {
    const result = await databases.listDocuments(DATABASE_ID, SUBSCRIPTIONS_COLLECTION, [
      Query.equal('active', true),
      Query.equal('status', 'active'),
      Query.lessThanEqual('nextReminderAt', now),
      Query.isNotNull('nextReminderAt'),
      Query.limit(PAGE_LIMIT),
    ]);
    dueSubs = result.documents;
  } catch (err) {
    error(`[SubReminders] Failed to query billing reminders: ${String(err)}`);
    return 0;
  }

  log(`[SubReminders] Found ${dueSubs.length} due billing reminder(s)`);

  for (const sub of dueSubs) {
    const subId = sub['$id'] as string;
    const userId = sub['userId'] as string;

    try {
      const msUntilBilling = (sub['nextBillingDate'] as number) - now;
      const daysUntil = Math.ceil(msUntilBilling / (24 * 60 * 60 * 1000));
      const dueLabel =
        daysUntil <= 0 ? 'today' : `in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`;

      const title = `${sub['serviceName'] as string} billing ${dueLabel}`;
      const body = `${sub['currency'] as string}${(sub['price'] as number).toFixed(2)} – ${sub['billingCycle'] as string}`;

      if (pushFunctionId) {
        await functions.createExecution(
          pushFunctionId,
          JSON.stringify({
            type: 'subscription',
            userId,
            subscriptionId: subId,
            title,
            body,
            reminderKind: 'billing',
          }),
          true,
        );
      }

      // advance: bump billing date if past, recompute nextReminderAt
      let nextBillingDate = sub['nextBillingDate'] as number;
      if (nextBillingDate <= now) {
        nextBillingDate = computeAdvancedBillingDate(
          nextBillingDate,
          sub['billingCycle'] as string,
          sub['billingCycleCustomDays'] as number | undefined,
        );
      }

      const reminderDaysBefore = deserializeReminderDaysBefore(sub['reminderDaysBefore']);
      const nextReminderAt = computeNextReminderAt(nextBillingDate, reminderDaysBefore);

      await databases.updateDocument(DATABASE_ID, SUBSCRIPTIONS_COLLECTION, subId, {
        nextBillingDate,
        nextReminderAt: nextReminderAt ?? null,
        lastNotifiedBillingDate: sub['nextBillingDate'],
        updatedAt: now,
      });

      log(`[SubReminders] Billing notified for ${subId} (${sub['serviceName'] as string})`);
      notified++;
    } catch (err) {
      error(`[SubReminders] Billing failed for ${subId}: ${String(err)}`);
    }
  }

  return notified;
}

// ---------------------------------------------------------------------------
// Step 2: Trial-end reminders
// ---------------------------------------------------------------------------

async function processTrialReminders(
  databases: Databases,
  functions: Functions,
  pushFunctionId: string | undefined,
  now: number,
  log: (msg: string) => void,
  error: (msg: string) => void,
): Promise<number> {
  let notified = 0;

  let dueTrials: SubDoc[];
  try {
    const result = await databases.listDocuments(DATABASE_ID, SUBSCRIPTIONS_COLLECTION, [
      Query.equal('active', true),
      Query.equal('status', 'active'),
      Query.lessThanEqual('nextTrialReminderAt', now),
      Query.isNotNull('nextTrialReminderAt'),
      Query.limit(PAGE_LIMIT),
    ]);
    dueTrials = result.documents;
  } catch (err) {
    error(`[SubReminders] Failed to query trial reminders: ${String(err)}`);
    return 0;
  }

  log(`[SubReminders] Found ${dueTrials.length} due trial reminder(s)`);

  for (const sub of dueTrials) {
    const subId = sub['$id'] as string;
    const userId = sub['userId'] as string;

    try {
      const trialEndDate = (sub['trialEndDate'] as number | undefined) ?? 0;
      const msUntilTrialEnd = trialEndDate - now;
      const daysUntil = Math.ceil(msUntilTrialEnd / (24 * 60 * 60 * 1000));
      const dueLabel =
        daysUntil <= 0 ? 'today' : `in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`;

      const title = `${sub['serviceName'] as string} trial ends ${dueLabel}`;
      const body = `${sub['currency'] as string}${(sub['price'] as number).toFixed(2)} – ${sub['billingCycle'] as string} billing starts after trial`;

      if (pushFunctionId) {
        await functions.createExecution(
          pushFunctionId,
          JSON.stringify({
            type: 'subscription',
            userId,
            subscriptionId: subId,
            title,
            body,
            reminderKind: 'trial_end',
          }),
          true,
        );
      }

      const reminderDaysBefore = deserializeReminderDaysBefore(sub['reminderDaysBefore']);
      const nextTrialReminderAt = computeNextReminderAt(trialEndDate, reminderDaysBefore);

      await databases.updateDocument(DATABASE_ID, SUBSCRIPTIONS_COLLECTION, subId, {
        nextTrialReminderAt: nextTrialReminderAt ?? null,
        lastNotifiedTrialEndDate: trialEndDate,
        updatedAt: now,
      });

      log(`[SubReminders] Trial notified for ${subId} (${sub['serviceName'] as string})`);
      notified++;
    } catch (err) {
      error(`[SubReminders] Trial failed for ${subId}: ${String(err)}`);
    }
  }

  return notified;
}

// ---------------------------------------------------------------------------
// Step 3: Auto-advance overdue billing dates (no push)
// ---------------------------------------------------------------------------

async function advanceOverdueBilling(
  databases: Databases,
  now: number,
  log: (msg: string) => void,
  error: (msg: string) => void,
): Promise<number> {
  let advanced = 0;

  let overdueSubs: SubDoc[];
  try {
    const result = await databases.listDocuments(DATABASE_ID, SUBSCRIPTIONS_COLLECTION, [
      Query.equal('active', true),
      Query.equal('status', 'active'),
      Query.lessThanEqual('nextBillingDate', now),
      Query.limit(PAGE_LIMIT),
    ]);
    overdueSubs = result.documents;
  } catch (err) {
    error(`[SubReminders] Failed to query overdue billing: ${String(err)}`);
    return 0;
  }

  for (const sub of overdueSubs) {
    const subId = sub['$id'] as string;
    try {
      let nextBillingDate = sub['nextBillingDate'] as number;

      // keep advancing until billing date is in the future
      while (nextBillingDate <= now) {
        nextBillingDate = computeAdvancedBillingDate(
          nextBillingDate,
          sub['billingCycle'] as string,
          sub['billingCycleCustomDays'] as number | undefined,
        );
      }

      const reminderDaysBefore = deserializeReminderDaysBefore(sub['reminderDaysBefore']);
      const nextReminderAt = computeNextReminderAt(nextBillingDate, reminderDaysBefore);

      await databases.updateDocument(DATABASE_ID, SUBSCRIPTIONS_COLLECTION, subId, {
        nextBillingDate,
        nextReminderAt: nextReminderAt ?? null,
        updatedAt: now,
      });

      log(`[SubReminders] Advanced billing date for ${subId}`);
      advanced++;
    } catch (err) {
      error(`[SubReminders] Failed to advance billing for ${subId}: ${String(err)}`);
    }
  }

  return advanced;
}

// ---------------------------------------------------------------------------
// Helper — deserialize reminderDaysBefore (stored as JSON string in Appwrite)
// ---------------------------------------------------------------------------

function deserializeReminderDaysBefore(value: unknown): number[] {
  if (Array.isArray(value)) return value as number[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed as number[];
    } catch {
      // ignore
    }
  }
  return [];
}
