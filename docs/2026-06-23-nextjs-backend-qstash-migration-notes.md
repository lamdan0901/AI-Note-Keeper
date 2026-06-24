# Next.js Backend + QStash Migration Notes

Date: 2026-06-23

## Summary

If the background worker is intentionally replaced by QStash-triggered reminder execution, then a Next.js backend becomes a reasonable target for this repo.

Recommended target shape:

- Keep Postgres.
- Keep the existing service and repository layer where possible, but adapt database connection management for the chosen Next.js deployment target.
- Move HTTP endpoints from Express routers to Next.js route handlers.
- Keep QStash as the one-shot reminder scheduler and callback trigger.
- Remove the pg-boss worker after reminder delivery, repair, subscription reminder dispatch, push retry behavior, and maintenance paths are covered elsewhere.
- Run Next.js API routes on the Node runtime, not the Edge runtime.

Main caveat:

- QStash replaces the per-reminder trigger path.
- QStash does not automatically replace coarse repair, backfill, and downtime recovery concerns.
- QStash also does not automatically replace subscription reminder scanning or push retry scheduling.
- A small maintenance path still needs to exist after the worker is removed.

## Scope Decision Required

The current web app is Vite, not Next.js: [`apps/web/package.json`](../apps/web/package.json).

Before implementation, choose one target:

1. Replace `apps/web` with a Next.js app and host the API routes inside that app.
2. Add a new Next.js backend app alongside the existing Vite web app.
3. Keep the Vite web app and migrate only the backend runtime later, if Next.js is still the target.

Recommended option:

- Replace `apps/web` only if the product is ready to absorb a frontend framework migration.
- Add a separate Next.js backend app if the goal is to de-risk backend hosting first.

## Current QStash State In Repo

The repo already contains the main pieces needed for a QStash-based reminder flow:

- Scheduler provider using Upstash QStash: [`apps/backend/src/reminders/scheduler-provider.ts`](../apps/backend/src/reminders/scheduler-provider.ts)
- Reminder runtime wiring for QStash config, callback URL, and verifier config: [`apps/backend/src/reminders/runtime.ts`](../apps/backend/src/reminders/runtime.ts)
- Internal callback route for `/internal/reminders/scheduled-task`: [`apps/backend/src/reminders/internal-routes.ts`](../apps/backend/src/reminders/internal-routes.ts)
- Express mounting of the internal callback route when QStash is enabled: [`apps/backend/src/runtime/createApiServer.ts`](../apps/backend/src/runtime/createApiServer.ts)
- API startup wiring that exposes the scheduled-task executor and verifier config: [`apps/backend/src/runtime/startApi.ts`](../apps/backend/src/runtime/startApi.ts)

This means the repo is already partway through the architecture change. The main remaining question is not "can QStash work here", but "what remains after pg-boss is gone".

## Target Next.js Shape

Suggested target architecture:

1. Next.js route handler receives create or update reminder request.
2. Existing service layer writes to Postgres.
3. Reminder scheduler service schedules the next occurrence through QStash.
4. QStash calls a protected internal Next.js route at fire time.
5. That route verifies the signature, executes the scheduled task, sends notifications, advances the reminder, and schedules the next occurrence.
6. A separate maintenance route or cron path repairs missed or unscheduled reminders after downtime or operational drift.

## Files That Can Move Mostly Unchanged

These files are mainly domain, repository, or integration logic and should be reusable with thin adapters.

### Core config and DB

- [`apps/backend/src/config.ts`](../apps/backend/src/config.ts)
- [`apps/backend/src/db/bootstrap.ts`](../apps/backend/src/db/bootstrap.ts)
- [`apps/backend/src/db/migrations/00001_users.sql`](../apps/backend/src/db/migrations/00001_users.sql)
- [`apps/backend/src/db/migrations/00002_notes.sql`](../apps/backend/src/db/migrations/00002_notes.sql)
- [`apps/backend/src/db/migrations/00003_subscriptions.sql`](../apps/backend/src/db/migrations/00003_subscriptions.sql)
- [`apps/backend/src/db/migrations/00004_device_push_tokens.sql`](../apps/backend/src/db/migrations/00004_device_push_tokens.sql)
- [`apps/backend/src/db/migrations/00005_note_change_events.sql`](../apps/backend/src/db/migrations/00005_note_change_events.sql)
- [`apps/backend/src/db/migrations/00006_cron_state.sql`](../apps/backend/src/db/migrations/00006_cron_state.sql)
- [`apps/backend/src/db/migrations/00007_migration_attempts.sql`](../apps/backend/src/db/migrations/00007_migration_attempts.sql)
- [`apps/backend/src/db/migrations/00008_refresh_tokens.sql`](../apps/backend/src/db/migrations/00008_refresh_tokens.sql)
- [`apps/backend/src/db/migrations/00009_core_indexes.sql`](../apps/backend/src/db/migrations/00009_core_indexes.sql)
- [`apps/backend/src/db/migrations/00010_expense_notes.sql`](../apps/backend/src/db/migrations/00010_expense_notes.sql)
- [`apps/backend/src/db/migrations/00011_reminder_scheduler.sql`](../apps/backend/src/db/migrations/00011_reminder_scheduler.sql)

### Auth

- [`apps/backend/src/auth/contracts.ts`](../apps/backend/src/auth/contracts.ts)
- [`apps/backend/src/auth/http.ts`](../apps/backend/src/auth/http.ts)
- [`apps/backend/src/auth/passwords.ts`](../apps/backend/src/auth/passwords.ts)
- [`apps/backend/src/auth/service.ts`](../apps/backend/src/auth/service.ts)
- [`apps/backend/src/auth/tokens.ts`](../apps/backend/src/auth/tokens.ts)
- [`apps/backend/src/auth/repositories/users-repository.ts`](../apps/backend/src/auth/repositories/users-repository.ts)
- [`apps/backend/src/auth/repositories/refresh-tokens-repository.ts`](../apps/backend/src/auth/repositories/refresh-tokens-repository.ts)

### Notes

- [`apps/backend/src/notes/contracts.ts`](../apps/backend/src/notes/contracts.ts)
- [`apps/backend/src/notes/service.ts`](../apps/backend/src/notes/service.ts)
- [`apps/backend/src/notes/repositories/notes-repository.ts`](../apps/backend/src/notes/repositories/notes-repository.ts)
- [`apps/backend/src/notes/repositories/note-change-events-repository.ts`](../apps/backend/src/notes/repositories/note-change-events-repository.ts)

### Reminders

- [`apps/backend/src/reminders/contracts.ts`](../apps/backend/src/reminders/contracts.ts)
- [`apps/backend/src/reminders/service.ts`](../apps/backend/src/reminders/service.ts)
- [`apps/backend/src/reminders/scheduler-service.ts`](../apps/backend/src/reminders/scheduler-service.ts)
- [`apps/backend/src/reminders/scheduler-provider.ts`](../apps/backend/src/reminders/scheduler-provider.ts)
- [`apps/backend/src/reminders/scheduled-task-executor.ts`](../apps/backend/src/reminders/scheduled-task-executor.ts)
- [`apps/backend/src/reminders/runtime.ts`](../apps/backend/src/reminders/runtime.ts)
- [`apps/backend/src/reminders/notification-sender.ts`](../apps/backend/src/reminders/notification-sender.ts)
- [`apps/backend/src/reminders/notification-text.ts`](../apps/backend/src/reminders/notification-text.ts)
- [`apps/backend/src/reminders/repositories/reminders-repository.ts`](../apps/backend/src/reminders/repositories/reminders-repository.ts)
- [`apps/backend/src/reminders/repositories/reminder-deliveries-repository.ts`](../apps/backend/src/reminders/repositories/reminder-deliveries-repository.ts)

### Device tokens and push delivery

- [`apps/backend/src/device-tokens/contracts.ts`](../apps/backend/src/device-tokens/contracts.ts)
- [`apps/backend/src/device-tokens/service.ts`](../apps/backend/src/device-tokens/service.ts)
- [`apps/backend/src/device-tokens/repositories/device-tokens-repository.ts`](../apps/backend/src/device-tokens/repositories/device-tokens-repository.ts)
- [`apps/backend/src/jobs/push/contracts.ts`](../apps/backend/src/jobs/push/contracts.ts)
- [`apps/backend/src/jobs/push/push-delivery-service.ts`](../apps/backend/src/jobs/push/push-delivery-service.ts)
- [`apps/backend/src/jobs/push/fcm-provider.ts`](../apps/backend/src/jobs/push/fcm-provider.ts)

### Other domain modules

- [`apps/backend/src/subscriptions/contracts.ts`](../apps/backend/src/subscriptions/contracts.ts)
- [`apps/backend/src/subscriptions/service.ts`](../apps/backend/src/subscriptions/service.ts)
- [`apps/backend/src/subscriptions/repositories/subscriptions-repository.ts`](../apps/backend/src/subscriptions/repositories/subscriptions-repository.ts)
- [`apps/backend/src/expenses/contracts.ts`](../apps/backend/src/expenses/contracts.ts)
- [`apps/backend/src/expenses/service.ts`](../apps/backend/src/expenses/service.ts)
- [`apps/backend/src/expenses/repository.ts`](../apps/backend/src/expenses/repository.ts)
- [`apps/backend/src/merge/contracts.ts`](../apps/backend/src/merge/contracts.ts)
- [`apps/backend/src/merge/service.ts`](../apps/backend/src/merge/service.ts)
- [`apps/backend/src/merge/repositories/merge-repository.ts`](../apps/backend/src/merge/repositories/merge-repository.ts)
- [`apps/backend/src/ai/contracts.ts`](../apps/backend/src/ai/contracts.ts)
- [`apps/backend/src/ai/provider.ts`](../apps/backend/src/ai/provider.ts)
- [`apps/backend/src/ai/service.ts`](../apps/backend/src/ai/service.ts)
- [`apps/backend/src/ai/rate-limit.ts`](../apps/backend/src/ai/rate-limit.ts)
- [`apps/backend/src/errors/catalog.ts`](../apps/backend/src/errors/catalog.ts)

## Files That Need Adapter Rewrites

These files are not lost work, but they are tied to Express or direct Node HTTP app startup and should be translated rather than copied verbatim.

### API entrypoints and server boot

- [`apps/backend/src/index.ts`](../apps/backend/src/index.ts)
- [`apps/backend/src/runtime/startApi.ts`](../apps/backend/src/runtime/startApi.ts)
- [`apps/backend/src/runtime/createApiServer.ts`](../apps/backend/src/runtime/createApiServer.ts)

Why:

- These are built around `express()` and `app.listen(...)`.
- In Next.js, route handlers replace this layer.
- The service construction logic can stay, but the server boot layer should disappear.

### Express route modules

- [`apps/backend/src/auth/routes.ts`](../apps/backend/src/auth/routes.ts)
- [`apps/backend/src/notes/routes.ts`](../apps/backend/src/notes/routes.ts)
- [`apps/backend/src/reminders/routes.ts`](../apps/backend/src/reminders/routes.ts)
- [`apps/backend/src/reminders/internal-routes.ts`](../apps/backend/src/reminders/internal-routes.ts)
- [`apps/backend/src/subscriptions/routes.ts`](../apps/backend/src/subscriptions/routes.ts)
- [`apps/backend/src/expenses/routes.ts`](../apps/backend/src/expenses/routes.ts)
- [`apps/backend/src/device-tokens/routes.ts`](../apps/backend/src/device-tokens/routes.ts)
- [`apps/backend/src/merge/routes.ts`](../apps/backend/src/merge/routes.ts)
- [`apps/backend/src/ai/routes.ts`](../apps/backend/src/ai/routes.ts)

Why:

- Request parsing, response writing, and route composition are Express-specific.
- Validation and service calls can mostly survive, but route modules need Next.js handler wrappers.

### Middleware and request plumbing

- [`apps/backend/src/middleware/error-middleware.ts`](../apps/backend/src/middleware/error-middleware.ts)
- [`apps/backend/src/middleware/validate.ts`](../apps/backend/src/middleware/validate.ts)
- [`apps/backend/src/auth/access-middleware.ts`](../apps/backend/src/auth/access-middleware.ts)
- [`apps/backend/src/health.ts`](../apps/backend/src/health.ts)

Why:

- These are shaped around Express request and response types.
- Next.js needs equivalent helpers based on `NextRequest`, `NextResponse`, and route-local error handling.

### CLI and migration entry scripts

- [`apps/backend/src/migrate.ts`](../apps/backend/src/migrate.ts)
- [`apps/backend/src/backfillReminderSchedules.ts`](../apps/backend/src/backfillReminderSchedules.ts)
- [`apps/backend/src/migration-tools/index.ts`](../apps/backend/src/migration-tools/index.ts)
- [`apps/backend/src/migration-tools/commands/export.ts`](../apps/backend/src/migration-tools/commands/export.ts)
- [`apps/backend/src/migration-tools/commands/import.ts`](../apps/backend/src/migration-tools/commands/import.ts)
- [`apps/backend/src/migration-tools/commands/reconcile.ts`](../apps/backend/src/migration-tools/commands/reconcile.ts)
- [`apps/backend/src/migration-tools/checkpoints.ts`](../apps/backend/src/migration-tools/checkpoints.ts)
- [`apps/backend/src/migration-tools/reporting.ts`](../apps/backend/src/migration-tools/reporting.ts)
- [`apps/backend/src/migration-tools/contracts.ts`](../apps/backend/src/migration-tools/contracts.ts)
- [`apps/backend/src/migration-tools/io/json-artifact.ts`](../apps/backend/src/migration-tools/io/json-artifact.ts)
- [`apps/backend/src/migration-tools/io/postgres-snapshot.ts`](../apps/backend/src/migration-tools/io/postgres-snapshot.ts)
- [`apps/backend/src/migration-tools/seed-convex-folder.ts`](../apps/backend/src/migration-tools/seed-convex-folder.ts)
- [`apps/backend/src/migration-tools/sources/convex-export-source.ts`](../apps/backend/src/migration-tools/sources/convex-export-source.ts)
- [`apps/backend/src/migration-tools/sources/ordering.ts`](../apps/backend/src/migration-tools/sources/ordering.ts)
- [`apps/backend/src/migration-tools/targets/postgres-import-target.ts`](../apps/backend/src/migration-tools/targets/postgres-import-target.ts)

Why:

- These are operational scripts, not request handlers.
- They can stay as separate Node scripts in the repo even if the runtime backend moves into Next.js.
- They should not be forced into Next.js route handlers.

### Database pool adapter

- [`apps/backend/src/db/pool.ts`](../apps/backend/src/db/pool.ts)

Why:

- The current pool uses a process-wide `pg.Pool` with `max: 20`.
- It calls `process.exit(-1)` on idle-client errors.
- That is acceptable for a long-running service, but risky in serverless or function-style Next.js deployments.
- The migration should either use a deployment target with stable Node processes and controlled pooling, or replace this with a serverless-safe connection strategy.

## Files That Can Be Deleted After pg-boss Removal

These are the clearest candidates for deletion once the replacement architecture is complete and verified.

### Worker runtime

- [`apps/backend/src/worker/index.ts`](../apps/backend/src/worker/index.ts)
- [`apps/backend/src/worker/contracts.ts`](../apps/backend/src/worker/contracts.ts)
- [`apps/backend/src/worker/boss-adapter.ts`](../apps/backend/src/worker/boss-adapter.ts)

### Legacy or worker-owned reminder dispatch

- [`apps/backend/src/jobs/reminders/dispatch-due-reminders.ts`](../apps/backend/src/jobs/reminders/dispatch-due-reminders.ts)
- [`apps/backend/src/jobs/reminders/due-reminder-scanner.ts`](../apps/backend/src/jobs/reminders/due-reminder-scanner.ts)
- [`apps/backend/src/jobs/reminders/cron-state-repository.ts`](../apps/backend/src/jobs/reminders/cron-state-repository.ts)
- [`apps/backend/src/jobs/reminders/contracts.ts`](../apps/backend/src/jobs/reminders/contracts.ts)

### Worker-owned subscription scanning

- [`apps/backend/src/jobs/subscriptions/dispatch-due-subscription-reminders.ts`](../apps/backend/src/jobs/subscriptions/dispatch-due-subscription-reminders.ts)
- [`apps/backend/src/jobs/subscriptions/scanner.ts`](../apps/backend/src/jobs/subscriptions/scanner.ts)
- [`apps/backend/src/jobs/subscriptions/state-repository.ts`](../apps/backend/src/jobs/subscriptions/state-repository.ts)
- [`apps/backend/src/jobs/subscriptions/contracts.ts`](../apps/backend/src/jobs/subscriptions/contracts.ts)

Delete condition:

- Only remove these once their responsibilities are either dead or intentionally moved to QStash-triggered execution plus separate maintenance paths.
- Subscription reminder dispatch currently runs through the worker and must have its own replacement path.
- Push retry scheduling currently runs through the worker and must be replaced or intentionally dropped.

## Files That Likely Stay But Change Role

These files should probably remain, but they stop being part of a long-running worker model.

- [`apps/backend/src/reminders/repair-job.ts`](../apps/backend/src/reminders/repair-job.ts)
- [`apps/backend/src/reminders/backfill-schedules.ts`](../apps/backend/src/reminders/backfill-schedules.ts)
- [`apps/backend/src/backfillReminderSchedules.ts`](../apps/backend/src/backfillReminderSchedules.ts)
- [`apps/backend/src/jobs/reminders/occurrence-advancer.ts`](../apps/backend/src/jobs/reminders/occurrence-advancer.ts)

Recommended new role:

- `repair-job.ts` becomes logic invoked by a maintenance route or scheduled task.
- `backfill-schedules.ts` remains an admin or operational command.
- `backfillReminderSchedules.ts` remains a script entrypoint.
- `occurrence-advancer.ts` stays as domain logic used by the scheduled-task path.

## Files That Are Likely Stale

- [`apps/backend/src/reminders/qstash-scheduler-provider.ts`](../apps/backend/src/reminders/qstash-scheduler-provider.ts)

Reason:

- The active reminder runtime imports QStash support from [`apps/backend/src/reminders/scheduler-provider.ts`](../apps/backend/src/reminders/scheduler-provider.ts).
- `qstash-scheduler-provider.ts` appears to be a parallel older provider covered by its own tests.
- Prefer deleting it after tests are migrated or after confirming it has no production caller.

## Remaining Gap After Worker Removal

The real architectural gap is maintenance and drift recovery.

Worker removal is safe only if all of the following are true:

- Reminder create and update paths schedule the authoritative next occurrence through QStash.
- QStash callback execution is fully idempotent.
- Missed or stale schedules can be repaired without a long-running worker.
- Subscription-related background behavior is either removed, migrated, or re-homed.
- Push retry behavior is either removed, migrated, or re-homed.
- Database connection handling is safe for the chosen Next.js deployment target.

The minimum replacement for the old worker model is:

1. Per-reminder scheduling via QStash.
2. Protected internal callback route for QStash delivery.
3. One coarse maintenance path for recovery.
4. One subscription reminder path if subscription reminders remain in product scope.
5. One push retry strategy if retry behavior remains required.

The maintenance path can be one of:

- A Vercel cron route that invokes `repair-job.ts`.
- A QStash-scheduled maintenance callback that invokes `repair-job.ts`.
- A manually run operational command for low-scale environments.

Recommended option:

- Use a small scheduled maintenance route.
- Keep it independent from per-reminder delivery.
- Run it at a coarse interval, only for repair and backfill.

## Practical Migration Order

1. Keep the current service and repository layer.
2. Decide whether Next.js replaces `apps/web` or lives as a separate backend app.
3. Adapt database connection handling for the selected Next.js hosting target.
4. Port one Express route group at a time to Next.js route handlers.
5. Port the QStash internal callback route early, because it is the backbone of the workerless reminder path.
6. Add a separate maintenance route for repair and backfill.
7. Replace or explicitly retire subscription reminder dispatch.
8. Replace or explicitly retire push retry scheduling.
9. Verify reminder create, update, fire, advance, cancel, recovery, subscription reminders, and push retry behavior.
10. Remove pg-boss worker code only after the maintenance and replacement paths have proven enough in testing.

## Recommendation

If the plan is:

- Next.js backend on Node runtime
- Postgres unchanged
- QStash for one-shot reminder scheduling
- serverless-safe or host-appropriate Postgres connection handling
- small repair and maintenance routes instead of a permanent reminder worker
- explicit replacement or retirement for subscription reminder dispatch and push retry scheduling

then this is a viable migration path and much cheaper than a Cloudflare Workers rewrite.

The main thing to avoid is pretending QStash alone erases every worker responsibility. It cleanly replaces the per-reminder trigger path, but repair, recovery, subscription scanning, push retries, and database pooling still need explicit homes.
