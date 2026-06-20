# Reminder Scheduler Redesign

Date: 2026-06-13
Status: Approved design, revised 2026-06-19 for Upstash QStash

## Goal

Replace the current always-on polling worker model for note reminders with a reminder scheduler that:

- supports one-time and recurring reminders similar to Google Keep
- applies reminder edits only to future fires from the time of edit
- sends reminder notifications from the backend only
- accepts a delivery window of up to one minute
- cancels scheduled deliveries when possible
- uses one external scheduled task for the next occurrence now
- keeps the option to fall back later to a coarse wake-up job plus `next_fire_at` in Postgres

This redesign must remove the need for a continuously running minute-by-minute reminder scanner in the normal path.

## Scope

In scope:

- reminder scheduling and delivery orchestration
- recurring reminder advancement
- stale schedule cancellation and validation
- catch-up after backend downtime
- storage required for durable execution and idempotency
- provider abstraction for external task schedulers

Out of scope:

- device-local reminder scheduling
- replacing the current push provider
- redesigning non-reminder background jobs
- introducing alternate scheduler providers in this slice beyond Upstash QStash

## Summary

The system will store reminders as the source of truth and schedule only the next due occurrence externally. In this revision, Upstash QStash is the concrete scheduler transport. When an occurrence fires, the backend validates that the reminder is still current, records a durable delivery row, sends the push notification, advances the recurrence, and schedules the next occurrence.

The external scheduler is an optimization and execution trigger, not the source of truth. Postgres remains authoritative through `next_fire_at`, reminder `version`, and durable delivery records. A coarse repair job remains available as a fallback and recovery mechanism, but it is not the primary scheduling loop.

## Architecture

### Core model

Each reminder has at most one active scheduled future occurrence at a time.

The reminder row stores:

- recurrence definition
- timezone and local schedule fields
- current `version`
- authoritative `next_fire_at`
- external schedule metadata for the currently scheduled occurrence

Each fired occurrence is recorded in a separate delivery table with a stable occurrence identity. This makes execution idempotent and gives the backend an audit trail for successful, stale, canceled, and failed deliveries.

### Scheduling strategy

Primary path:

- create one external scheduled task for the reminder's next occurrence
- execute the task through a backend handler at due time
- schedule the next occurrence only after the current one has been durably processed

Fallback path:

- run a coarse repair job on an interval
- detect overdue reminders, missing schedules, and scheduler drift
- backfill missed occurrences and recreate the next external schedule

### Why this design

This design avoids the two bad extremes:

- constant database polling by a permanently running worker
- precomputing an unbounded number of future occurrences for recurring reminders

It also cleanly supports a future move between infrastructure models because the storage model does not depend on one scheduler provider.

## Data Model

### `reminders`

The existing reminders table remains the source of truth and gains scheduler metadata.

Required scheduler fields:

- `version`
- `active`
- `deleted_at`
- `timezone`
- `schedule_type`
- `start_at`
- `base_at_local`
- `repeat_rule`
- `repeat_config`
- `snoozed_until`
- `next_fire_at`
- `last_fired_at`
- `last_acknowledged_at`
- `schedule_provider`
- `schedule_target_id`
- `schedule_target_version`
- `schedule_target_fire_at`

Behavioral rules:

- `next_fire_at` is the authoritative next due time
- `schedule_target_*` describes only the currently active external schedule
- edits increment `version`
- edits apply from now forward, not retroactively

### `reminder_deliveries`

Create a durable table for reminder occurrence execution.

Suggested fields:

- `id`
- `reminder_id`
- `user_id`
- `occurrence_at`
- `reminder_version`
- `delivery_key`
- `status`
- `provider_message_id`
- `attempt_count`
- `created_at`
- `sent_at`
- `failure_reason`

Required uniqueness:

- unique `(reminder_id, occurrence_at)`
- unique `delivery_key`

Behavioral rules:

- one logical reminder occurrence maps to one delivery row
- retries reuse the same logical occurrence identity
- duplicate execution attempts become no-ops after the first committed delivery row

### `scheduler_repair_state`

Reuse the existing cron-state mechanism or add a minimal repair-state row for:

- last repair run time
- last repair watermark
- last repair error

This state is operational and not user-facing.

## Provider Abstraction

Introduce a scheduler provider interface with the minimum behavior needed by the reminder system:

- `scheduleOnce`
- `cancel`
- `describe` or equivalent metadata validation if supported

Inputs to scheduling:

- reminder id
- occurrence timestamp
- reminder version
- delivery key

Outputs from scheduling:

- provider name
- provider schedule id
- scheduled fire timestamp

Design rules:

- provider failure must not mutate reminder truth incorrectly
- scheduling state must be persisted only after provider success
- provider cancellation is best-effort
- execution-time validation is the hard correctness boundary

### Concrete provider choice: Upstash QStash

The abstraction remains in place, but the concrete provider for this rollout is Upstash QStash.

Configuration:

- `REMINDER_SCHEDULER_PROVIDER=qstash`
- `REMINDER_SCHEDULER_CALLBACK_BASE_URL`
- `QSTASH_TOKEN`
- `QSTASH_CURRENT_SIGNING_KEY`
- `QSTASH_NEXT_SIGNING_KEY`
- `QSTASH_URL` optional when the default QStash endpoint is acceptable

Runtime behavior:

- build the callback destination URL as `new URL('/internal/reminders/scheduled-task', REMINDER_SCHEDULER_CALLBACK_BASE_URL)`
- publish one delayed QStash message for the next occurrence using the existing reminder scheduler payload
- store the returned QStash `messageId` as the reminder `schedule_target_id`
- cancel stale scheduled work by canceling the stored QStash message id
- preserve the `disabled` provider mode so rollout can be reversed without changing reminder truth

Inbound request trust moves from a shared secret header to native QStash signature verification:

- verify the `Upstash-Signature` header using the current and next signing keys
- verify against the exact callback URL derived from `REMINDER_SCHEDULER_CALLBACK_BASE_URL`
- verify against the exact raw request body before JSON parsing
- reject unsigned, wrongly signed, expired, or body-mismatched callbacks with `401`

The route path remains `/internal/reminders/scheduled-task` so the public callback contract stays stable while the trust mechanism changes.

## Execution Flow

### Create reminder

1. Validate reminder input and recurrence fields.
2. Compute `next_fire_at`.
3. Persist the reminder with initial `version`.
4. If `next_fire_at` exists, create one external scheduled task.
5. Persist returned scheduler metadata on the reminder row.

### Update reminder

1. Load current reminder.
2. Increment `version`.
3. Recompute future schedule from now forward.
4. Cancel the old external schedule if one exists.
5. Persist updated reminder and authoritative `next_fire_at`.
6. If still active and future-due, create a replacement external scheduled task.
7. Persist new scheduler metadata.

This update model intentionally discards the previous future schedule and replaces it from the edit point onward.

### Delete or deactivate reminder

1. Mark inactive or deleted.
2. Cancel the current external schedule if present.
3. Clear scheduler metadata fields.

### Scheduled task execution

1. Accept payload containing:
   - `reminder_id`
   - `occurrence_at`
   - `version`
   - `delivery_key`
2. Load the reminder.
3. If the reminder is missing, inactive, or deleted, record stale or canceled outcome and exit.
4. If payload `version` does not match current reminder `version`, record stale outcome and exit.
5. If payload `occurrence_at` does not match the reminder's due occurrence, record stale outcome and exit.
6. Insert a `reminder_deliveries` row.
7. If the insert conflicts on occurrence identity, treat execution as already handled and exit.
8. Send push notification.
9. Mark delivery status as sent.
10. Advance recurrence and compute the next `next_fire_at`.
11. Update reminder fields including `last_fired_at`.
12. If another occurrence exists, create the next external schedule and persist its metadata.
13. If no next occurrence exists, clear scheduler metadata.

For QStash-backed execution, the backend must verify the signature against the raw request body before parsing JSON. This verification happens at the HTTP boundary and is required before the reminder payload is trusted.

### Recovery and repair job

The fallback repair job runs on a coarse interval and repairs reminder scheduling state.

It must:

- find reminders where `next_fire_at <= now`
- find reminders missing scheduler metadata
- find reminders whose scheduler metadata is stale relative to reminder `version`
- replay overdue occurrences in order
- recreate the next external schedule after repair

This job is the resilience path for:

- backend downtime
- provider delay or schedule loss
- failed cancellation
- partial write or deployment interruptions

## Recurrence and Time Semantics

### Supported behavior

- one-time reminders
- recurring reminders
- edits apply only to future fires from edit time onward
- backend catch-up after missed execution windows
- delivery tolerance of up to one minute

### Catch-up semantics

If the backend misses time because it was down or unable to execute scheduled tasks, it must emit every missed occurrence in order during recovery. This applies to missed backend execution, not to temporary device offline state.

If the device is offline when the push is sent, push delivery behavior is delegated to the notification provider and device platform.

### Snooze semantics

Snooze affects the current occurrence only. It does not shift the full future series.

## Correctness Rules

The system must preserve these invariants:

- Postgres is the source of truth
- there is at most one active external next-occurrence schedule per reminder
- reminder `version` invalidates stale scheduled tasks
- each logical occurrence is idempotent
- cancellation is best-effort, validation is mandatory
- the repair job can reconstruct the correct future state from Postgres alone

This means external schedules can be lost or duplicated without corrupting reminder truth.

## Failure Handling

### Scheduler creation fails

- do not pretend the reminder is fully scheduled
- persist reminder state with `next_fire_at`
- leave scheduler metadata empty
- let the repair job create the missing external schedule later

For QStash, this covers publish failures, invalid callback destination configuration, or transport-level API errors.

### Scheduler cancellation fails

- continue the reminder update or delete
- rely on reminder `version` and active-state validation to no-op the stale task if it still executes

### Push send fails

- keep the occurrence row durable
- mark it failed with reason
- retry according to delivery policy
- do not schedule the successor occurrence until the current occurrence is resolved as sent or terminally failed
- do not advance recurrence twice for the same occurrence

### Backend crash during execution

- delivery row uniqueness prevents duplicate logical sends after restart
- repair job reconciles reminders whose `next_fire_at` is still overdue

## Observability

Track metrics and logs for:

- schedules created
- schedules canceled
- stale tasks rejected
- deliveries sent
- deliveries failed
- repair backfills executed
- overdue reminder count
- scheduling drift between intended fire time and actual execution time

These metrics are required to prove the redesign is actually removing the need for a hot polling worker without silently dropping reminders.

## Testing Strategy

### Unit tests

- next-occurrence computation for one-time and recurring reminders
- version mismatch rejection
- stale occurrence rejection
- idempotent delivery row insertion behavior
- recurrence advancement after delivery
- snooze handling for current occurrence only
- QStash provider publish and cancel request mapping
- callback signature verification using raw body and exact callback URL

### Integration tests

- create reminder schedules next occurrence
- update reminder cancels old schedule and creates replacement
- delete reminder cancels schedule and suppresses execution
- recurring reminder executes and schedules its successor
- duplicate scheduled task execution results in one delivery
- repair job backfills missed occurrences after simulated downtime
- internal callback route rejects unsigned or wrong-URL QStash deliveries
- internal callback route accepts a correctly signed raw payload and executes exactly once

### Contract tests

- provider adapter schedule and cancel behavior
- provider payload round-trip
- fallback behavior when provider create or cancel fails
- `disabled` mode remains startable without QStash configuration
- `qstash` mode requires callback base URL, token, and current/next signing keys

## Rollout Plan

1. Add schema changes and delivery table.
2. Introduce provider abstraction behind the current reminder scheduling code.
3. Implement next-occurrence scheduling path without removing the old repair path.
4. Add repair job as explicit fallback.
5. Migrate reminder execution to external next-occurrence scheduling.
6. Reduce or remove the minute-by-minute hot polling loop for reminders once parity is proven.

## Decision Log

- Use backend-authoritative reminder scheduling.
- Support one-time and recurring reminders.
- Apply reminder edits only to future fires from edit time onward.
- Accept delivery within one minute.
- Cancel scheduled deliveries when possible.
- Use one external scheduled task per next occurrence.
- Keep a coarse repair job plus `next_fire_at` in Postgres as fallback.
- Use durable occurrence records for idempotency and audit.
- Use Upstash QStash as the concrete scheduler transport for the generic HTTP provider slot.
- Derive the callback URL from `REMINDER_SCHEDULER_CALLBACK_BASE_URL` plus `/internal/reminders/scheduled-task`.
- Replace shared-secret callback authentication with native QStash signature verification over the exact raw request body.
