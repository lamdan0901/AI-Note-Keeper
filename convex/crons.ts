import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

// Check for due reminders every minute
crons.cron(
  'check-reminders',
  '* * * * *',
  internal.functions.reminderTriggers.checkAndTriggerReminders,
);

export default crons;
