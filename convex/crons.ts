import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

// Check for due reminders every minute
crons.cron(
  'check-reminders',
  '* * * * *',
  internal.functions.reminderTriggers.checkAndTriggerReminders,
);

// Purge soft-deleted notes older than 14 days, daily at 3 AM UTC
crons.cron('purge-expired-trash', '0 3 * * *', internal.functions.notes.purgeExpiredTrash);

// Check for due subscription billing reminders every hour
crons.cron(
  'check-subscription-reminders',
  '0 * * * *',
  internal.functions.subscriptions.checkSubscriptionReminders,
);

export default crons;
